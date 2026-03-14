import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: 'dummy', httpOptions: { baseUrl: 'http://localhost:3000' } });

async function main() {
  try {
    const session = await ai.live.connect({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' });
    console.log('Connected!');
    session.close();
  } catch (e: any) {
    console.log(e.message);
  }
}
main();
