/**
 * Test du fournisseur Groq contre un faux serveur.
 *
 * On ne teste pas Groq : on teste notre traduction. Les deux endroits où ce
 * genre d'intégration casse silencieusement sont (1) la conversion des blocs
 * Anthropic vers le format OpenAI — en particulier les résultats d'outils, qui
 * deviennent des messages à part entière — et (2) le réassemblage des
 * arguments d'outils arrivant en fragments de JSON.
 *
 * Le faux serveur découpe volontairement le JSON au milieu d'une clé, et
 * envoie les fragments SSE à cheval sur plusieurs paquets TCP.
 */
import { createServer } from 'node:http';
import { GroqProvider } from '../src/index.js';

const received: unknown[] = [];

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    received.push(JSON.parse(body));

    response.writeHead(200, { 'content-type': 'text/event-stream' });

    const chunks = [
      { choices: [{ delta: { content: 'Je regarde ' } }] },
      { choices: [{ delta: { content: 'ça.' } }] },
      // Appel d'outil fragmenté : nom d'abord, arguments en trois morceaux
      // dont un coupé au milieu d'une clé JSON.
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'etat_element', arguments: '' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"na' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"Vin' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tex"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 412, completion_tokens: 37 } },
    ];

    // Écriture en deux salves, avec une coupure au milieu d'un événement SSE :
    // c'est le cas qui casse les parseurs naïfs.
    const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
    const cut = Math.floor(lines.length * 0.43);
    response.write(lines.slice(0, cut));
    setTimeout(() => {
      response.write(lines.slice(cut));
      response.write('data: [DONE]\n\n');
      response.end();
    }, 15);
  });
});

await new Promise<void>((resolve) => server.listen(4788, '127.0.0.1', resolve));

const provider = new GroqProvider({
  apiKey: 'gsk_test',
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:4788/openai/v1',
});

const deltas: string[] = [];
const response = await provider.stream(
  {
    system: [{ text: 'Tu es Valmont.', cache: true }, { text: 'Sois bref.' }],
    messages: [
      { role: 'user', content: 'Où en est Vintex ?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Je vérifie.' },
          { type: 'tool_use', id: 'call_0', name: 'etat_element', input: { name: 'Vintex' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'call_0', content: '{"statut":"actif"}' }],
      },
    ],
    tools: [
      {
        name: 'etat_element',
        description: 'Consulte un projet.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    ],
  },
  { onTextDelta: (delta) => deltas.push(delta) },
);

const sent = received[0] as {
  messages: Array<{ role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }>;
  tools: Array<{ type: string; function: { name: string } }>;
};

const checks: Array<[string, boolean]> = [
  ['texte reconstitué', response.text === 'Je regarde ça.'],
  ['fragments diffusés', deltas.length === 2],
  ['un appel d’outil', response.toolUses.length === 1],
  ['arguments réassemblés', response.toolUses[0]?.input['name'] === 'Vintex'],
  ['raison d’arrêt', response.stopReason === 'tool_use'],
  ['usage relevé', response.usage.inputTokens === 412 && response.usage.outputTokens === 37],
  ['invite système fusionnée', sent.messages[0]?.role === 'system'],
  ['appel d’outil converti', Array.isArray(sent.messages[2]?.tool_calls)],
  // Le point qui casse le plus souvent : un résultat d'outil doit devenir un
  // message de rôle `tool`, pas rester un bloc dans un message utilisateur.
  ['résultat en message tool', sent.messages.at(-1)?.role === 'tool'],
  ['résultat rattaché', sent.messages.at(-1)?.tool_call_id === 'call_0'],
  ['outils au format function', sent.tools[0]?.type === 'function'],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed++;
  // eslint-disable-next-line no-console
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

server.close();
process.exit(failed === 0 ? 0 : 1);
