
export async function generateAzureSpeech(
  text: string,
  voiceName: string,
  region: string,
  key: string
): Promise<Uint8Array> {
  if (!text || !region || !key) {
    throw new Error('Missing Azure TTS configuration or text');
  }

  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  // SSML (Speech Synthesis Markup Language) for voice specification
  const ssml = `
    <speak version='1.0' xml:lang='en-US'>
      <voice xml:lang='en-US' xml:gender='${voiceName.includes('Female') || voiceName.includes('Ezinne') || voiceName.includes('Leah') || voiceName.includes('Asilia') ? 'Female' : 'Male'}' name='${voiceName}'>
        ${text}
      </voice>
    </speak>
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm', // Matches Gemini's 24kHz format
      'User-Agent': 'GeminiVoiceAgent'
    },
    body: ssml
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure TTS Error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
