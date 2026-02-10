figma.showUI(__html__, { width: 500, height: 520 });

// Template configs loaded from templates.json (or fallback). Loaded when first needed.
let TEMPLATE_CONFIGS = {};
// For auto-sync: only process when sentAt changes
let lastProcessedSentAt = null;

const STORAGE_KEYS = { workspace: 'audience_workspace', apiUrl: 'audience_api_url', lastProcessedSentAt: 'audience_last_processed_sent_at' };

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'format-quotes') {
    await formatSelectedQuotes();
  } else if (msg.type === 'process-json') {
    await processJsonInput(msg.json);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  } else if (msg.type === 'get-storage') {
    const workspace = await figma.clientStorage.getAsync(STORAGE_KEYS.workspace);
    const apiUrl = await figma.clientStorage.getAsync(STORAGE_KEYS.apiUrl);
    const savedSentAt = await figma.clientStorage.getAsync(STORAGE_KEYS.lastProcessedSentAt);
    if (savedSentAt != null) lastProcessedSentAt = savedSentAt;
    figma.ui.postMessage({ type: 'storage', workspace: workspace || '', apiUrl: apiUrl || '' });
  } else if (msg.type === 'set-storage') {
    await figma.clientStorage.setAsync(STORAGE_KEYS.workspace, msg.workspace || '');
    await figma.clientStorage.setAsync(STORAGE_KEYS.apiUrl, msg.apiUrl || '');
  } else if (msg.type === 'fetch-payload') {
    const apiUrl = (msg.apiUrl || '').trim().replace(/\/$/, '');
    const workspace = (msg.workspace || '').trim();
    if (!apiUrl) {
      figma.ui.postMessage({ type: 'error', message: 'API URL is required. Enter your backend URL (e.g. https://your-app.vercel.app).' });
      return;
    }
    if (!workspace) {
      figma.ui.postMessage({ type: 'error', message: 'Workspace name is required.' });
      return;
    }
    const manual = msg.manual === true;
    const since = manual ? '' : (lastProcessedSentAt != null ? lastProcessedSentAt : 0);
    const url = `${apiUrl}/api/payload?workspace=${encodeURIComponent(workspace)}${since !== '' ? `&since=${since}` : ''}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        figma.ui.postMessage({ type: 'error', message: data.error || `Error ${res.status}` });
        return;
      }

      if (data.payloads && Array.isArray(data.payloads)) {
        for (const p of data.payloads) {
          const json = p && p.json;
          const sentAt = p && p.sentAt;
          if (json == null) continue;
          lastProcessedSentAt = Math.max(lastProcessedSentAt || 0, sentAt || 0);
          await figma.clientStorage.setAsync(STORAGE_KEYS.lastProcessedSentAt, lastProcessedSentAt);
          await processJsonInput(json);
        }
        return;
      }

      const json = data.json;
      const sentAt = data.sentAt;
      if (json == null) {
        if (manual) figma.ui.postMessage({ type: 'error', message: 'No payload for this workspace yet. Send from the web app first.' });
        return;
      }
      if (manual || sentAt === undefined || sentAt === null || sentAt !== lastProcessedSentAt) {
        lastProcessedSentAt = sentAt;
        await figma.clientStorage.setAsync(STORAGE_KEYS.lastProcessedSentAt, lastProcessedSentAt);
        await processJsonInput(json);
      }
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: 'Network error: ' + (e.message || 'Check API URL and connection.') });
    }
  }
};


async function loadTemplateConfigs() {
  try {
    const response = await fetch('https://miriamwaldvogel.github.io/instagram-post/templates.json');
    if (!response.ok) {
      throw new Error('Failed to load templates.json');
    }
    TEMPLATE_CONFIGS = await response.json();
    console.log('Loaded template configs:', TEMPLATE_CONFIGS);
  } catch (error) {
    console.error('Error loading templates.json:', error);
    // Fallback to hardcoded values if network fails
    TEMPLATE_CONFIGS = {
      "Two chunk quote": { maxFont: 75, nameFont: 60, positionFont: 50 },
      "One chunk quote": { maxFont: 75, nameFont: 60, positionFont: 50 },
      "Quote with header": { maxFont: 60, nameFont: 60, positionFont: 50 },
      "Opinion cover 1": { maxFont: 80, nameFont: 60, positionFont: 55 },
      "Opinion cover 2": { maxFont: 70, nameFont: 46, positionFont: 46 },
      "Features cover 1": { maxFont: 85 },
      "Sports cover 1": { maxFont: 75 },
      "News cover 1": { maxFont: 80 },
      "News cover 2": { maxFont: 80 },
      "Prospect cover 1": { maxFont: 70 }
    };
  }
}

async function processJsonInput(jsonString) {
  try {
    // Ensure template configs are loaded before processing (from templates.json or fallback)
    await loadTemplateConfigs();

    const data = JSON.parse(jsonString);
    
    // Create a new frame to hold all slides
    const outputFrame = figma.createFrame();
    outputFrame.name = "Generated Instagram Slides";
    outputFrame.layoutMode = "HORIZONTAL";
    outputFrame.itemSpacing = 20;
    outputFrame.fills = [];
    outputFrame.clipsContent = false;
    
    let processedCount = 0;
    
    // Process cover slide if present
    if (data.coverSlide) {
      const coverInstance = await createCoverSlideInstance(data.coverSlide);
      if (coverInstance) {
        outputFrame.appendChild(coverInstance);
        processedCount++;
      }
    }
    
    // Process regular slides
    if (data.slides && Array.isArray(data.slides)) {
      for (let i = 0; i < data.slides.length; i++) {
        const slide = data.slides[i];
        
        if (!slide.template) {
          throw new Error(`Slide ${i + 1} missing "template" field`);
        }
        
        if (!slide.texts || !Array.isArray(slide.texts)) {
          throw new Error(`Slide ${i + 1} missing "texts" array`);
        }
        
        // Find the template component
        const templateComponent = await findComponent(slide.template);
        if (!templateComponent) {
          throw new Error(`Template "${slide.template}" not found in document`);
        }
        
        // Create an instance of the template
        const instance = templateComponent.createInstance();
        outputFrame.appendChild(instance);
        
        // Get max font size for this template
        const templateConfig = TEMPLATE_CONFIGS[slide.template];
        
        // Process the instance
        await processSlideInstance(instance, slide.texts, slide.speaker, slide.position, templateConfig, slide.backgroundImageUrl);
        
        processedCount++;
      }
    }
    
    if (processedCount === 0) {
      throw new Error('No slides to process. JSON must contain "slides" array or "coverSlide" object');
    }
    
    // Position the output frame in the viewport
    outputFrame.x = figma.viewport.center.x - outputFrame.width / 2;
    outputFrame.y = figma.viewport.center.y - outputFrame.height / 2;
    
    // Select the new frame
    figma.currentPage.selection = [outputFrame];
    figma.viewport.scrollAndZoomIntoView([outputFrame]);
    
    figma.ui.postMessage({ 
      type: 'success', 
      message: `Created ${processedCount} slide${processedCount !== 1 ? 's' : ''}!` 
    });
    
  } catch (error) {
    console.error('Error processing JSON:', error);
    figma.ui.postMessage({ 
      type: 'error', 
      message: `Error: ${error.message}` 
    });
  }
}

async function createCoverSlideInstance(coverData) {
  try {
    // Find the cover template
    const templateComponent = await findComponent(coverData.template);
    if (!templateComponent) {
      console.error(`Template "${coverData.template}" not found in document`);
      return null;
    }
    
    // Create an instance
    const instance = templateComponent.createInstance();
    
    // Keep clipping as is - don't change it
    
    // Get template config
    const templateConfig = TEMPLATE_CONFIGS[coverData.template] || { maxFont: 80 };
    
    // Find and populate Headline with auto-resize
    if (coverData.headline) {
      const headlineNode = instance.findOne(node => 
        node.type === 'TEXT' && node.name === 'Headline'
      );
      if (headlineNode) {
        await figma.loadFontAsync(headlineNode.fontName);
        
        const boxWidth = headlineNode.width;
        const boxHeight = headlineNode.height;
        
        headlineNode.characters = coverData.headline;
        
        // Auto-resize headline to fit
        const headlineData = [{
          node: headlineNode,
          width: boxWidth,
          height: boxHeight,
          text: coverData.headline
        }];
        
        const optimalSize = await findOptimalFontSize(headlineData, templateConfig.maxFont);
        headlineNode.fontSize = optimalSize;
        headlineNode.textAutoResize = 'NONE';
        headlineNode.resize(boxWidth, boxHeight);
      }
    }
    
    // Find and populate Section
    if (coverData.section) {
      const sectionNode = instance.findOne(node => 
        node.type === 'TEXT' && node.name === 'Section'
      );
      if (sectionNode) {
        await figma.loadFontAsync(sectionNode.fontName);
        sectionNode.characters = coverData.section.toUpperCase();
      }
    }
    
    // Find and populate Dom media (image)
    if (coverData.coverImageUrl) {
      const imageNode = instance.findOne(node => 
        node.name === 'Dom media'
      );
      if (imageNode) {
        try {
          // Fetch the image
          const imageBytes = await fetch(coverData.coverImageUrl).then(r => r.arrayBuffer());
          const image = figma.createImage(new Uint8Array(imageBytes));
          
          // Apply to the node
          if (imageNode.type === 'RECTANGLE' || imageNode.type === 'FRAME') {
            imageNode.fills = [{
              type: 'IMAGE',
              scaleMode: 'FILL',
              imageHash: image.hash
            }];
          }
        } catch (error) {
          console.error('Failed to load image:', error);
        }
      }
    }
    
    // Find and populate Name and position
    if (coverData.name || coverData.position) {
      const namePositionNode = instance.findOne(node => 
        node.type === 'TEXT' && node.name === 'Name and position'
      );
      
      if (namePositionNode) {
        await processNamePositionNode(namePositionNode, coverData.name, coverData.position, templateConfig);
      }
    }
    
    return instance;
    
  } catch (error) {
    console.error('Error processing cover slide:', error);
    return null;
  }
}

async function findComponent(name) {
  // Search for component in the current file
  const components = figma.root.findAll(node => 
    node.type === 'COMPONENT' && node.name === name
  );
  
  return components.length > 0 ? components[0] : null;
}

async function processSlideInstance(instance, texts, speaker, position, templateConfig, backgroundImageUrl) {
  // Keep clipping as is - don't change it
  const config = templateConfig || {};

  // Background image: fill node named "Background image" if template supports it and URL provided
  if (config.backgroundImage && backgroundImageUrl) {
    const bgNode = instance.findOne(node =>
      node.name === 'Background image'
    );
    if (bgNode) {
      try {
        const imageBytes = await fetch(backgroundImageUrl).then(r => r.arrayBuffer());
        const image = figma.createImage(new Uint8Array(imageBytes));
        if (bgNode.type === 'RECTANGLE' || bgNode.type === 'FRAME' || bgNode.type === 'ELLIPSE') {
          bgNode.fills = [{
            type: 'IMAGE',
            scaleMode: 'FILL',
            imageHash: image.hash
          }];
        }
      } catch (error) {
        console.error('Failed to load background image:', error);
      }
    }
  }

  // Find all text layers - separate Headers and Quotes
  const headerLayers = [];
  const quoteLayers = [];
  
  function findTextLayers(node) {
    if (node.type === 'TEXT') {
      if (/^Header \d+$/.test(node.name)) {
        headerLayers.push(node);
      } else if (/^Quote \d+$/.test(node.name)) {
        quoteLayers.push(node);
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        findTextLayers(child);
      }
    }
  }
  
  findTextLayers(instance);
  
  // Sort by name
  headerLayers.sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/)[0]);
    const numB = parseInt(b.name.match(/\d+/)[0]);
    return numA - numB;
  });
  
  quoteLayers.sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/)[0]);
    const numB = parseInt(b.name.match(/\d+/)[0]);
    return numA - numB;
  });
  
  // Combine all text layers in order (headers first, then quotes)
  const allTextLayers = [...headerLayers, ...quoteLayers];
  
  // Process text layers
  const headerData = [];
  const quoteData = [];
  
  let textIndex = 0;
  
  // Process headers
  for (let i = 0; i < headerLayers.length && textIndex < texts.length; i++) {
    const textNode = headerLayers[i];
    const text = texts[textIndex++];
    
    await figma.loadFontAsync(textNode.fontName);
    
    const boxWidth = textNode.width;
    const boxHeight = textNode.height;
    
    const segments = parseMarkdown(text);
    const cleanText = text.replace(/\*\*/g, '');
    textNode.characters = cleanText;
    
    await applyFormatting(textNode, segments);
    
    headerData.push({
      node: textNode,
      width: boxWidth,
      height: boxHeight,
      text: cleanText
    });
  }
  
  // Process quotes
  for (let i = 0; i < quoteLayers.length && textIndex < texts.length; i++) {
    const textNode = quoteLayers[i];
    const text = texts[textIndex++];
    
    await figma.loadFontAsync(textNode.fontName);
    
    const boxWidth = textNode.width;
    const boxHeight = textNode.height;
    
    const segments = parseMarkdown(text);
    const cleanText = text.replace(/\*\*/g, '');
    textNode.characters = cleanText;
    
    await applyFormatting(textNode, segments);
    
    quoteData.push({
      node: textNode,
      width: boxWidth,
      height: boxHeight,
      text: cleanText
    });
  }
  
  // Find and process Name and position layer only when template has nameFont/positionFont > 0
  const hasNamePosition = (config.nameFont || 0) > 0 || (config.positionFont || 0) > 0;
  if (hasNamePosition) {
    const namePositionNode = instance.findOne(node =>
      node.type === 'TEXT' && node.name === 'Name and position'
    );
    if (namePositionNode) {
      await processNamePositionNode(namePositionNode, speaker || '', position || '', config);
    }
  }
  
  // Find optimal font sizes separately for headers and quotes
  const maxFontSize = templateConfig.maxFont || 80;
  if (headerData.length > 0) {
    const optimalHeaderSize = await findOptimalFontSize(headerData, maxFontSize);
    
    for (const data of headerData) {
      data.node.fontSize = optimalHeaderSize;
      data.node.textAutoResize = 'NONE';
      data.node.resize(data.width, data.height);
    }
  }
  
  if (quoteData.length > 0) {
    const optimalQuoteSize = await findOptimalFontSize(quoteData, maxFontSize);
    
    for (const data of quoteData) {
      data.node.fontSize = optimalQuoteSize;
      data.node.textAutoResize = 'NONE';
      data.node.resize(data.width, data.height);
    }
  }
}

async function processNamePositionNode(node, name, position, templateConfig) {
  await figma.loadFontAsync(node.fontName);
  
  const nameText = name || '';
  const positionText = position || '';
  const fullText = nameText + (nameText && positionText ? '\n' : '') + positionText;
  
  node.characters = fullText;
  
  // Get font sizes from template config, with defaults
  const nameFontSize = templateConfig.nameFont || 60;
  const positionFontSize = templateConfig.positionFont || 50;
  
  // Apply font sizes to different lines
  if (nameText) {
    const currentFont = node.getRangeFontName(0, 1);
    await figma.loadFontAsync(currentFont);
    node.setRangeFontSize(0, nameText.length, nameFontSize);
  }
  
  if (positionText && nameText) {
    // Position line starts after name + newline
    const positionStart = nameText.length + 1;
    node.setRangeFontSize(positionStart, positionStart + positionText.length, positionFontSize);
  } else if (positionText) {
    // Only position, no name
    node.setRangeFontSize(0, positionText.length, positionFontSize);
  }
}

async function formatSelectedQuotes() {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Please select at least one frame' });
    return;
  }

  let processedCount = 0;

  for (const node of selection) {
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      try {
        await processFrame(node);
        processedCount++;
      } catch (error) {
        console.error('Error processing frame:', error);
        figma.ui.postMessage({ type: 'error', message: `Error: ${error.message}` });
      }
    }
  }

  if (processedCount > 0) {
    figma.ui.postMessage({ 
      type: 'success', 
      message: `Processed ${processedCount} frame${processedCount !== 1 ? 's' : ''}` 
    });
  } else {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Please select a frame, component, or instance' 
    });
  }
}

async function processFrame(frame) {
  // Find all text layers named "Quote 1", "Quote 2", etc. (for manual mode compatibility)
  const textLayers = [];
  
  function findTextLayers(node) {
    if (node.type === 'TEXT' && (/^Quote \d+$/.test(node.name) || /^Text \d+$/.test(node.name))) {
      textLayers.push(node);
    }
    if ('children' in node) {
      for (const child of node.children) {
        findTextLayers(child);
      }
    }
  }
  
  findTextLayers(frame);
  
  if (textLayers.length === 0) {
    throw new Error('No text layers named "Quote 1", "Quote 2", etc. found in selection');
  }
  
  // Sort by name
  textLayers.sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/)[0]);
    const numB = parseInt(b.name.match(/\d+/)[0]);
    return numA - numB;
  });
  
  // Get max font size from component property or use default
  let maxFontSize = 72;
  
  if (frame.type === 'INSTANCE' && frame.componentProperties && frame.mainComponent) {
    for (const [key, prop] of Object.entries(frame.componentProperties)) {
      if (prop.type === 'TEXT') {
        const propDefs = frame.mainComponent.componentPropertyDefinitions;
        if (propDefs && propDefs[key]) {
          const propDef = propDefs[key];
          if (propDef.name === 'Max main text') {
            const parsedMax = parseFloat(prop.value);
            if (!isNaN(parsedMax) && parsedMax > 0) {
              maxFontSize = parsedMax;
            }
            break;
          }
        }
      }
    }
  }
  
  // Process each text layer
  const textData = [];
  for (const textNode of textLayers) {
    await figma.loadFontAsync(textNode.fontName);
    
    const text = textNode.characters;
    const boxWidth = textNode.width;
    const boxHeight = textNode.height;
    
    const segments = parseMarkdown(text);
    const cleanText = text.replace(/\*\*/g, '');
    textNode.characters = cleanText;
    
    await applyFormatting(textNode, segments);
    
    textData.push({
      node: textNode,
      width: boxWidth,
      height: boxHeight,
      text: cleanText
    });
  }
  
  // Find optimal font size and apply
  const optimalSize = await findOptimalFontSize(textData, maxFontSize);
  
  for (const data of textData) {
    data.node.fontSize = optimalSize;
    data.node.textAutoResize = 'NONE';
    data.node.resize(data.width, data.height);
  }
}

function parseMarkdown(text) {
  const segments = [];
  let cleanPos = 0;
  
  const regex = /\*\*(.+?)\*\*/g;
  let match;
  let lastIndex = 0;
  
  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchEnd = regex.lastIndex;
    const boldText = match[1];
    
    if (matchStart > lastIndex) {
      const normalText = text.substring(lastIndex, matchStart);
      segments.push({
        start: cleanPos,
        end: cleanPos + normalText.length,
        isBold: false
      });
      cleanPos += normalText.length;
    }
    
    segments.push({
      start: cleanPos,
      end: cleanPos + boldText.length,
      isBold: true
    });
    cleanPos += boldText.length;
    
    lastIndex = matchEnd;
  }
  
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex).replace(/\*\*/g, '');
    segments.push({
      start: cleanPos,
      end: cleanPos + remainingText.length,
      isBold: false
    });
  }
  
  return segments;
}

async function applyFormatting(node, segments) {
  const orangeColor = { r: 1, g: 0.5, b: 0 };
  
  for (const segment of segments) {
    if (segment.isBold && segment.start < segment.end) {
      node.setRangeFills(segment.start, segment.end, [
        { type: 'SOLID', color: orangeColor }
      ]);
    }
  }
}

async function findOptimalFontSize(textData, maxFontSize) {
  const minSize = 8;
  const fontSizes = [];
  
  for (const data of textData) {
    const node = data.node;
    const currentFont = node.getRangeFontName(0, 1);
    await figma.loadFontAsync(currentFont);
    
    let low = minSize;
    let high = maxFontSize;
    let bestSize = minSize;
    
    // Set to fixed size first, preserving width
    node.textAutoResize = 'NONE';
    const savedWidth = node.width;
    node.resize(data.width, data.height);
    
    // Now enable height auto-resize
    node.textAutoResize = 'HEIGHT';
    // Ensure width stays fixed
    if (node.width !== savedWidth) {
      node.resize(savedWidth, node.height);
    }
    
    console.log(`  After setup - width: ${node.width}, height: ${node.height}, autoResize: ${node.textAutoResize}`);
    
    while (high - low > 0.5) {
      const mid = (low + high) / 2;
      node.fontSize = mid;
      
      console.log(`  Testing size ${mid.toFixed(1)}: height=${node.height.toFixed(1)} vs target=${data.height.toFixed(1)}`);
      
      if (node.height <= data.height * 0.95) {
        bestSize = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    
    console.log(`  Best size for ${node.name}: ${bestSize.toFixed(1)}`);
    fontSizes.push(bestSize);
  }
  
  const finalSize = Math.min(...fontSizes);
  console.log('Final font size (minimum):', finalSize.toFixed(1));
  
  return finalSize;
}