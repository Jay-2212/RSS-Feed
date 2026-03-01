import axios from 'axios';
import 'dotenv/config';

async function testInceptionAPI() {
  const apiKey = process.env.INCEPTION_API_KEY;
  const baseUrl = process.env.INCEPTION_BASE_URL || 'https://api.inceptionlabs.ai/v1';
  const model = process.env.INCEPTION_MODEL || 'mercury-2';

  if (!apiKey) {
    console.error('Error: INCEPTION_API_KEY is not set in .env');
    return;
  }

  const endpoint = `${baseUrl}/chat/completions`.replace(/([^:]\/)\/+/g, '$1');
  console.log(`Testing endpoint: ${endpoint}`);
  console.log(`Model: ${model}`);

  const testPayloads = [
    {
      name: 'Standard OpenAI Style (Current Code)',
      data: {
        model,
        messages: [
          { role: 'system', content: 'Test prompt.' },
          { role: 'user', content: 'Hello' }
        ],
        temperature: 0.1,
        max_tokens: 10
      }
    },
    {
      name: 'Developer Role Only (Reasoning Model Style)',
      data: {
        model,
        messages: [
          { role: 'developer', content: 'Test prompt.' },
          { role: 'user', content: 'Hello' }
        ],
        max_tokens: 10
      }
    },
    {
      name: 'No System/Developer Message',
      data: {
        model,
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        max_tokens: 10
      }
    }
  ];

  for (const payload of testPayloads) {
    console.log(`
--- Testing: ${payload.name} ---`);
    try {
      const response = await axios.post(endpoint, payload.data, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });
      console.log('Success!', response.status);
      console.log('Response:', JSON.stringify(response.data.choices[0].message, null, 2));
    } catch (error) {
      console.error('Failed!', error.response?.status || error.message);
      if (error.response?.data) {
        console.error('Error details:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

testInceptionAPI();
