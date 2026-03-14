import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: 'dummy', httpOptions: { baseUrl: 'http://localhost:3000' } });

async function main() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Hello'
    });
    console.log(response.text);
  } catch (e: any) {
    console.log(e.message);
  }
}
main();
