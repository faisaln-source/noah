import { promises as fs } from 'node:fs';
const destination = 'data/test-speech.wav';
try { await fs.access(destination); }
catch {
  await fs.mkdir('data', { recursive: true });
  const response = await fetch('https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav');
  if (!response.ok) throw new Error('Could not download the public Whisper speech test fixture');
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}
