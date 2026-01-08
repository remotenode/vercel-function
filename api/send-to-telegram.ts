import type { VercelRequest, VercelResponse } from '@vercel/node';

interface ProjectConfig {
  id: string;
  botToken: string;
  channelId: string;
}

interface TelegramRequest {
  projectId: string;
  message: string;
  files?: Array<{
    filename: string;
    content: string; // base64 encoded
    mimeType?: string;
  }>;
}

// Parse configuration from environment variable
function getProjectConfigs(): ProjectConfig[] {
  const configJson = process.env.TELEGRAM_CONFIGS;
  if (!configJson) {
    throw new Error('TELEGRAM_CONFIGS environment variable is not set');
  }
  
  try {
    const configs = JSON.parse(configJson);
    if (!Array.isArray(configs)) {
      throw new Error('TELEGRAM_CONFIGS must be a JSON array');
    }
    return configs;
  } catch (error) {
    throw new Error(`Failed to parse TELEGRAM_CONFIGS: ${error}`);
  }
}

// Find project configuration by ID
function findProjectConfig(projectId: string): ProjectConfig | null {
  const configs = getProjectConfigs();
  return configs.find(config => config.id === projectId) || null;
}

// Send message to Telegram
async function sendMessage(
  botToken: string,
  channelId: string,
  message: string
): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: channelId,
      text: message,
      parse_mode: 'HTML',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }

  return response.json();
}

// Send document to Telegram
async function sendDocument(
  botToken: string,
  channelId: string,
  filename: string,
  content: Buffer,
  caption?: string
): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  
  const formData = new FormData();
  formData.append('chat_id', channelId);
  
  // Create a Blob from Buffer for proper file upload
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('document', blob, filename);
  
  if (caption) {
    formData.append('caption', caption);
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }

  return response.json();
}

// Main handler
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projectId, message, files }: TelegramRequest = req.body;

    // Validate input
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    if (!message && (!files || files.length === 0)) {
      return res.status(400).json({ 
        error: 'Either message or files must be provided' 
      });
    }

    // Find project configuration
    const config = findProjectConfig(projectId);
    if (!config) {
      return res.status(404).json({ 
        error: `Project configuration not found for ID: ${projectId}` 
      });
    }

    const results: any[] = [];

    // Send message if provided
    if (message) {
      const messageResult = await sendMessage(
        config.botToken,
        config.channelId,
        message
      );
      results.push({ type: 'message', result: messageResult });
    }

    // Send files if provided
    if (files && files.length > 0) {
      for (const file of files) {
        try {
          // Decode base64 content
          const buffer = Buffer.from(file.content, 'base64');
          
          const fileResult = await sendDocument(
            config.botToken,
            config.channelId,
            file.filename,
            buffer,
            message ? undefined : message // Use message as caption if no separate message sent
          );
          
          results.push({ 
            type: 'file', 
            filename: file.filename, 
            result: fileResult 
          });
        } catch (error) {
          results.push({ 
            type: 'file', 
            filename: file.filename, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      projectId,
      results,
    });

  } catch (error) {
    console.error('Error sending to Telegram:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
