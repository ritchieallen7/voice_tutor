const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const WebSocket = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // WebSocket proxy for OpenAI Realtime API
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url);
    
    if (pathname === '/api/realtime/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Create connection to OpenAI
        const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17', {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        // Relay messages between client and OpenAI
        openaiWs.on('open', () => {
          console.log('Connected to OpenAI Realtime API');
          
          // Send initial configuration
          openaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text', 'audio'],
              instructions: `You are a friendly language tutor helping students practice English. 
                Be conversational and natural. Test their knowledge of new words they've learned.
                Provide pronunciation feedback and vocabulary practice in a flowing conversation.
                Don't make them repeat individual words unless they ask - keep it conversational.`,
              voice: 'alloy',
              input_audio_format: 'pcm16',
              output_audio_format: 'pcm16',
              input_audio_transcription: {
                model: 'whisper-1'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
              },
              temperature: 0.8
            }
          }));
        });

        openaiWs.on('message', (data) => {
          ws.send(data.toString());
        });

        openaiWs.on('error', (error) => {
          console.error('OpenAI WebSocket error:', error);
          ws.close();
        });

        openaiWs.on('close', () => {
          ws.close();
        });

        ws.on('message', (data) => {
          if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(data.toString());
          }
        });

        ws.on('close', () => {
          openaiWs.close();
        });
      });
    } else {
      socket.destroy();
    }
  });

  server.once('error', (err) => {
    console.error(err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});