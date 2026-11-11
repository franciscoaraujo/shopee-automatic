// Gera n8n/workflow-shopee-afiliados.json a partir dos arquivos em n8n/code-nodes.
// Uso: node scripts/build-workflow.js
//
// As credenciais NÃO ficam no workflow: o nó "Config" busca a configuração no
// painel (GET /api/internal/config) a cada execução, autenticado pelo token
// interno DASHBOARD_INGEST_TOKEN (variável de ambiente do container n8n).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const code = (f) => fs.readFileSync(path.join(root, 'n8n', 'code-nodes', f), 'utf8');

const CFG = "$('Config').first().json";
const DASH_URL = "$env.DASHBOARD_INTERNAL_URL || 'http://dashboard:3100'";
const DASH_TOKEN = '$env.DASHBOARD_INGEST_TOKEN';

const id = (n) => `5b0e${String(n).padStart(4, '0')}-1a2b-4c3d-8e9f-0a1b2c3d4e5f`;

// Nó HTTP de observabilidade: falhas aqui nunca interrompem a esteira
const obsHttp = (n, name, pos) => ({
  parameters: {
    method: 'POST',
    url: `={{ ${DASH_URL} }}/api/ingest`,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'x-ingest-token', value: `={{ ${DASH_TOKEN} }}` }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json) }}',
    options: { timeout: 5000 },
  },
  id: id(n),
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: pos,
  onError: 'continueRegularOutput',
});

const shopeeHttp = (n, name, pos) => ({
  parameters: {
    method: 'POST',
    url: '={{ $json.url }}',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Authorization', value: '={{ $json.authorization }}' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: '={{ $json.body }}',
    options: { timeout: 30000 },
  },
  id: id(n),
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: pos,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 3000,
});

const codeNode = (n, name, file, pos) => ({
  parameters: { jsCode: code(file) },
  id: id(n),
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos,
});

// IF: canal ativado nas Configurações do painel?
const channelGate = (n, name, flag, pos) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [
        {
          id: id(200 + n),
          leftValue: `={{ ${CFG}.${flag} }}`,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
  id: id(n),
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: pos,
});

const nodes = [
  {
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } },
    id: id(1),
    name: 'A cada 30 min',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 0],
  },
  {
    parameters: {},
    id: id(2),
    name: 'Teste Manual',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, 200],
  },
  {
    // Busca credenciais e parâmetros no painel (http://localhost:3100 -> Configurações)
    parameters: {
      method: 'GET',
      url: `={{ ${DASH_URL} }}/api/internal/config`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'x-ingest-token', value: `={{ ${DASH_TOKEN} }}` }] },
      options: { timeout: 10000 },
    },
    id: id(3),
    name: 'Config',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [240, 100],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    notes: 'Credenciais vêm do painel (Configurações). Nada sensível fica salvo no workflow.',
  },
  codeNode(4, 'Assinar productOfferV2', '01-assinar-product-offer.js', [480, 100]),
  shopeeHttp(5, 'Shopee - productOfferV2', [720, 100]),
  codeNode(6, 'Filtrar Ofertas', '02-filtrar-ofertas.js', [1200, 100]),
  codeNode(7, 'Assinar generateShortLink', '03-assinar-short-link.js', [1440, 100]),
  shopeeHttp(8, 'Shopee - generateShortLink', [1680, 100]),
  codeNode(9, 'Formatar Copy', '04-formatar-copy.js', [1920, 100]),
  channelGate(16, 'Telegram ativo?', 'telegramEnabled', [2160, 0]),
  channelGate(17, 'WhatsApp ativo?', 'whatsappEnabled', [2160, 200]),
  {
    parameters: {
      method: 'POST',
      url: `=https://api.telegram.org/bot{{ ${CFG}.telegramBotToken }}/sendPhoto`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: ${CFG}.telegramChatId, photo: $json.imageUrl, caption: $json.telegramCaption, parse_mode: 'Markdown' }) }}`,
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 3000 } },
        timeout: 30000,
      },
    },
    id: id(10),
    name: 'Telegram - sendPhoto',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2400, 0],
    onError: 'continueRegularOutput',
  },
  {
    parameters: {
      method: 'POST',
      url: `={{ ${CFG}.evolutionUrl }}/message/sendMedia/{{ ${CFG}.evolutionInstance }}`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'apikey', value: `={{ ${CFG}.evolutionApiKey }}` }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ number: ${CFG}.whatsappGroupJid, mediatype: 'image', mimetype: 'image/jpeg', media: $json.imageUrl, fileName: 'oferta-' + $json.itemId + '.jpg', caption: $json.whatsappCaption }) }}`,
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 8000 } },
        timeout: 60000,
      },
    },
    id: id(11),
    name: 'WhatsApp - Evolution sendMedia',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2400, 200],
    onError: 'continueRegularOutput',
  },
  // --- novas tentativas: a Shopee devolve erros transitórios com HTTP 200 ---
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id: id(230),
            // 10000 = System Error intermitente; 10030 = limite de requisições. Até 3 novas tentativas.
            leftValue: '={{ [10000, 10030].includes(Number($json.errors?.[0]?.extensions?.code)) && $runIndex < 3 }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: id(18),
    name: 'Erro temporário Shopee?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [960, 100],
  },
  {
    parameters: { resume: 'timeInterval', amount: 5, unit: 'seconds' },
    id: id(19),
    name: 'Aguardar nova tentativa',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [960, 320],
    webhookId: '5b0e0019-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  },
  // --- observabilidade ---
  // Acima de "Filtrar Ofertas" (y menor) para rodar antes dele na ordem v1
  codeNode(12, 'Obs - Resumo da Busca', '05-obs-resumo-busca.js', [1200, -160]),
  obsHttp(13, 'Obs - Registrar Busca', [1440, -160]),
  codeNode(14, 'Obs - Normalizar Entregas', '06-obs-normalizar-entregas.js', [2640, 100]),
  obsHttp(15, 'Obs - Registrar Entregas', [2880, 100]),
];

const link = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });

const connections = {
  'A cada 30 min': link('Config'),
  'Teste Manual': link('Config'),
  Config: link('Assinar productOfferV2'),
  'Assinar productOfferV2': link('Shopee - productOfferV2'),
  'Shopee - productOfferV2': link('Erro temporário Shopee?'),
  // saída 0 (verdadeiro) = erro transitório → espera e assina de novo; saída 1 = segue
  'Erro temporário Shopee?': {
    main: [
      [{ node: 'Aguardar nova tentativa', type: 'main', index: 0 }],
      [
        { node: 'Obs - Resumo da Busca', type: 'main', index: 0 },
        { node: 'Filtrar Ofertas', type: 'main', index: 0 },
      ],
    ],
  },
  'Aguardar nova tentativa': link('Assinar productOfferV2'),
  'Obs - Resumo da Busca': link('Obs - Registrar Busca'),
  'Filtrar Ofertas': link('Assinar generateShortLink'),
  'Assinar generateShortLink': link('Shopee - generateShortLink'),
  'Shopee - generateShortLink': link('Formatar Copy'),
  'Formatar Copy': {
    main: [
      [
        { node: 'Telegram ativo?', type: 'main', index: 0 },
        { node: 'WhatsApp ativo?', type: 'main', index: 0 },
      ],
    ],
  },
  // saída 0 = verdadeiro; saída 1 (falso) não segue adiante
  'Telegram ativo?': { main: [[{ node: 'Telegram - sendPhoto', type: 'main', index: 0 }], []] },
  'WhatsApp ativo?': { main: [[{ node: 'WhatsApp - Evolution sendMedia', type: 'main', index: 0 }], []] },
  'Telegram - sendPhoto': link('Obs - Normalizar Entregas'),
  'WhatsApp - Evolution sendMedia': link('Obs - Normalizar Entregas'),
  'Obs - Normalizar Entregas': link('Obs - Registrar Entregas'),
};

const workflow = {
  name: 'Shopee Afiliados -> Telegram + WhatsApp',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo' },
  tags: [],
};

// Garantia: nenhum segredo literal no JSON gerado
const json = JSON.stringify(workflow, null, 2) + '\n';
if (/\$env\.(SHOPEE|TELEGRAM|WHATSAPP|EVOLUTION)/.test(json)) {
  throw new Error('O workflow não deve ler credenciais de $env — elas vêm do painel');
}

const outFile = path.join(root, 'n8n', 'workflow-shopee-afiliados.json');
fs.writeFileSync(outFile, json, 'utf8');
console.log(`OK -> ${path.relative(root, outFile)} (${nodes.length} nós)`);
