import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// === COLE AQUI O SEU firebaseConfig DO CONSOLE DO FIREBASE ===
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000:web:00000000000"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Tickers que funcionam na brapi.dev mesmo sem token
const TICKERS_LIVRES = ['PETR4', 'VALE3', 'MGLU3', 'ITUB4'];
const RADAR_PADRAO = ['ITUB4', 'BBAS3', 'TAEE11', 'PETR4', 'VALE3', 'MXRF11', 'HGLG11'];

let ativos = [];
let aportesMes = [];
let dividendosMes = [];
let cotacoes = JSON.parse(localStorage.getItem('rico_cotacoes_cache') || '{}');
let config = {
  meta_renda_mensal: 2000,
  meta_aporte_mensal: 1000,
  brapi_token: '',
  radar_tickers: RADAR_PADRAO
};
let filtroAtual = 'TODOS';

const hoje = new Date();
const mesReferencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
document.getElementById('mes-atual-label').textContent =
  `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

function brl(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// === CARREGAMENTO DO FIREBASE ===
async function carregarDados() {
  const statusEl = document.getElementById('status-conexao');

  try {
    const metaRef = doc(db, 'config', 'metas');
    const qAportes = query(collection(db, 'aportes'), where('mes_referencia', '==', mesReferencia));
    const qDivs = query(collection(db, 'dividendos'), where('mes_referencia', '==', mesReferencia));

    const [metaSnap, ativosSnap, aportesSnap, divsSnap] = await Promise.all([
      getDoc(metaRef),
      getDocs(collection(db, 'ativos')),
      getDocs(qAportes),
      getDocs(qDivs)
    ]);

    if (metaSnap.exists()) {
      config = { ...config, ...metaSnap.data() };
      if (!Array.isArray(config.radar_tickers) || config.radar_tickers.length === 0) {
        config.radar_tickers = RADAR_PADRAO;
      }
    }

    ativos = ativosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ativos.sort((a, b) => a.ticker.localeCompare(b.ticker));

    aportesMes = aportesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    aportesMes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    dividendosMes = divsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    dividendosMes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    statusEl.textContent = `Rico • ${ativos.length} ativo(s)`;

    document.getElementById('input-meta-renda').value = config.meta_renda_mensal;
    document.getElementById('input-meta-aporte').value = config.meta_aporte_mensal;
    document.getElementById('input-brapi-token').value = config.brapi_token || '';

    atualizarResumo();
    renderizarCarteira();
    renderizarHistoricos();
    gerarAnaliseCoach();
    renderizarRadar();
  } catch (err) {
    statusEl.textContent = 'Erro ao conectar no Firebase';
    console.error(err);
  }
}

// === COTAÇÕES DA B3 VIA BRAPI.DEV ===
async function buscarCotacaoTicker(ticker) {
  const token = (config.brapi_token || '').trim();
  if (!token && !TICKERS_LIVRES.includes(ticker)) {
    return { erro: 'Sem token brapi.dev' };
  }

  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(
      `https://brapi.dev/api/v2/stocks/quote?symbols=${encodeURIComponent(ticker)}`,
      { headers }
    );
    if (!resp.ok) return { erro: `HTTP ${resp.status}` };
    const json = await resp.json();
    const d = json.results?.[0]?.data;
    if (!d || typeof d.regularMarketPrice !== 'number') return { erro: 'Indisponível' };

    return {
      preco: d.regularMarketPrice,
      variacao: d.regularMarketChangePercent ?? 0,
      min52: d.fiftyTwoWeekLow ?? null,
      max52: d.fiftyTwoWeekHigh ?? null,
      nome: d.shortName || ticker,
      atualizadoEm: Date.now()
    };
  } catch {
    return { erro: 'Falha de rede' };
  }
}

async function atualizarCotacoesECoach() {
  const btnB3 = document.getElementById('btn-atualizar-b3');
  const btnCoach = document.getElementById('btn-analisar-coach');
  const infoEl = document.getElementById('info-cotacao');

  const todosTickers = Array.from(new Set([
    ...ativos.map((a) => a.ticker),
    ...(config.radar_tickers || [])
  ]));

  if (todosTickers.length === 0) return;

  btnB3.disabled = true;
  btnCoach.disabled = true;

  // Plano gratuito da brapi permite 1 requisição simultânea por vez
  for (let i = 0; i < todosTickers.length; i++) {
    const t = todosTickers[i];
    const progresso = `Buscando B3 (${i + 1}/${todosTickers.length}): ${t}...`;
    btnB3.textContent = progresso;
    btnCoach.textContent = progresso;

    const resultado = await buscarCotacaoTicker(t);
    cotacoes[t] = resultado;
  }

  localStorage.setItem('rico_cotacoes_cache', JSON.stringify(cotacoes));

  btnB3.disabled = false;
  btnCoach.disabled = false;
  btnB3.textContent = '🔄 Atualizar Cotações da B3';
  btnCoach.textContent = '🧠 Analisar Carteira & Radar Hoje';
  infoEl.textContent = `Cotações atualizadas às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  atualizarResumo();
  renderizarCarteira();
  gerarAnaliseCoach();
  renderizarRadar();
}

// === RESUMO DO DASHBOARD ===
function atualizarResumo() {
  let totalInvestido = 0, totalFIIs = 0, totalAcoes = 0;
  let rendaTotal = 0, rendaFIIs = 0, rendaAcoes = 0;
  let valorMercadoTotal = 0, dividendosTotaisRecebidos = 0;
  let temCotacao = false;

  ativos.forEach((a) => {
    const qtd = Number(a.quantidade);
    const pm = Number(a.preco_medio);
    const investido = qtd * pm;
    const renda = qtd * Number(a.dividendo_mensal_cota);
    const divsRec = Number(a.dividendos_recebidos || 0);

    totalInvestido += investido;
    rendaTotal += renda;
    dividendosTotaisRecebidos += divsRec;

    const cot = cotacoes[a.ticker];
    if (cot && typeof cot.preco === 'number') {
      valorMercadoTotal += qtd * cot.preco;
      temCotacao = true;
    } else {
      valorMercadoTotal += investido;
    }

    if (a.tipo === 'FII') {
      totalFIIs += investido;
      rendaFIIs += renda;
    } else {
      totalAcoes += investido;
      rendaAcoes += renda;
    }
  });

  // Meta de Renda
  const metaRenda = Number(config.meta_renda_mensal) || 1;
  const percMeta = Math.min(100, (rendaTotal / metaRenda) * 100);
  const faltaRenda = Math.max(0, metaRenda - rendaTotal);

  document.getElementById('renda-atual').textContent = brl(rendaTotal);
  document.getElementById('perc-meta').textContent = `${percMeta.toFixed(1)}%`;
  document.getElementById('barra-meta').style.width = `${percMeta}%`;
  document.getElementById('meta-renda-label').textContent = brl(metaRenda);
  document.getElementById('falta-renda-label').textContent =
    faltaRenda === 0 ? 'Meta batida!' : `Faltam ${brl(faltaRenda)}/mês`;

  // Aporte do Mês
  const totalAportadoMes = aportesMes.reduce((acc, item) => acc + Number(item.valor), 0);
  const metaAporte = Number(config.meta_aporte_mensal) || 1;
  const percAporte = Math.min(100, (totalAportadoMes / metaAporte) * 100);
  const faltaAporte = Math.max(0, metaAporte - totalAportadoMes);

  document.getElementById('aporte-mes-atual').textContent = brl(totalAportadoMes);
  document.getElementById('perc-aporte').textContent = `${percAporte.toFixed(0)}%`;
  document.getElementById('barra-aporte').style.width = `${percAporte}%`;
  document.getElementById('meta-aporte-label').textContent = brl(metaAporte);
  document.getElementById('falta-aporte-label').textContent =
    faltaAporte === 0 ? 'Aporte do mês completo!' : `Faltam ${brl(faltaAporte)}`;

  // Dividendos recebidos no mês & Retorno Real
  const totalDivMes = dividendosMes.reduce((acc, d) => acc + Number(d.valor), 0);
  document.getElementById('dividendos-mes-atual').textContent = `Div. Mês: ${brl(totalDivMes)}`;
  document.getElementById('total-investido').textContent = brl(totalInvestido);

  const mercadoEl = document.getElementById('valor-mercado-total');
  const retornoEl = document.getElementById('retorno-total-geral');

  if (temCotacao) {
    mercadoEl.textContent = brl(valorMercadoTotal);
    const retornoReal = (valorMercadoTotal + dividendosTotaisRecebidos) - totalInvestido;
    const retornoPerc = totalInvestido > 0 ? (retornoReal / totalInvestido) * 100 : 0;
    retornoEl.className = retornoReal >= 0 ? 'var-pos' : 'var-neg';
    retornoEl.textContent = `Retorno real: ${retornoReal >= 0 ? '+' : ''}${brl(retornoReal)} (${retornoPerc.toFixed(1)}%)`;
  } else {
    mercadoEl.textContent = 'Toque em "Atualizar B3"';
    retornoEl.textContent = `Divs. acumulados: ${brl(dividendosTotaisRecebidos)}`;
  }

  document.getElementById('total-fiis').textContent = brl(totalFIIs);
  document.getElementById('renda-fiis').textContent = `Rende ${brl(rendaFIIs)}/mês`;
  document.getElementById('total-acoes').textContent = brl(totalAcoes);
  document.getElementById('renda-acoes').textContent = `Rende ${brl(rendaAcoes)}/mês`;

  // Projeção
  const projEl = document.getElementById('texto-projecao');
  if (faltaRenda === 0 && rendaTotal > 0) {
    projEl.textContent = 'Parabéns! Sua carteira atual já gera a renda mensal estipulada na sua meta.';
    return;
  }

  const dyMensal = (totalInvestido > 0 && rendaTotal > 0) ? (rendaTotal / totalInvestido) : 0.008;
  const patrimonioAlvo = metaRenda / dyMensal;
  const faltaPatrimonio = Math.max(0, patrimonioAlvo - totalInvestido);

  let saldo = totalInvestido;
  let meses = 0;
  if (metaAporte > 0) {
    while (saldo < patrimonioAlvo && meses < 600) {
      saldo = saldo * (1 + dyMensal) + metaAporte;
      meses++;
    }
  }

  const anos = Math.floor(meses / 12);
  const mesesRest = meses % 12;
  const tempoTxt = meses === 0 ? 'indefinido (defina um aporte mensal)' :
    anos > 0 ? `~${anos} ano(s) e ${mesesRest} mês(es)` : `~${mesesRest} mês(es)`;

  projEl.textContent = `Com seu Yield médio de ${(dyMensal * 100).toFixed(2)}% a.m., você precisa acumular cerca de ${brl(patrimonioAlvo)} (faltam ${brl(faltaPatrimonio)}). Mantendo aportes de ${brl(metaAporte)}/mês e reinvestindo os dividendos, o prazo estimado é de ${tempoTxt}.`;
}

// === RENDER CARTEIRA ===
function renderizarCarteira() {
  const container = document.getElementById('lista-ativos');
  container.innerHTML = '';

  const filtrados = ativos.filter((a) => filtroAtual === 'TODOS' || a.tipo === filtroAtual);

  if (filtrados.length === 0) {
    container.innerHTML = '<p class="dica-center" style="padding:20px;">Nenhum ativo nesta categoria.</p>';
    return;
  }

  filtrados.forEach((a) => {
    const qtd = Number(a.quantidade);
    const pm = Number(a.preco_medio);
    const divCota = Number(a.dividendo_mensal_cota);
    const divsRec = Number(a.dividendos_recebidos || 0);
    const investido = qtd * pm;
    const rendaMes = qtd * divCota;

    const cot = cotacoes[a.ticker];
    const temPreco = cot && typeof cot.preco === 'number';
    const valorAtual = temPreco ? qtd * cot.preco : investido;
    const retornoTotal = (valorAtual + divsRec) - investido;
    const retornoPerc = investido > 0 ? (retornoTotal / investido) * 100 : 0;

    const card = document.createElement('div');
    card.className = 'ativo-card';

    const header = document.createElement('div');
    header.className = 'ativo-header';

    const tituloBox = document.createElement('div');
    tituloBox.className = 'ativo-titulo';
    const strong = document.createElement('strong');
    strong.textContent = a.ticker;
    const tag = document.createElement('span');
    tag.className = `tag-tipo tag-${a.tipo === 'FII' ? 'FII' : 'ACAO'}`;
    tag.textContent = a.tipo === 'FII' ? 'FII' : 'AÇÃO';
    tituloBox.append(strong, tag);

    const varEl = document.createElement('span');
    if (temPreco) {
      const sinal = cot.variacao >= 0 ? '▲ +' : '▼ ';
      varEl.className = cot.variacao >= 0 ? 'var-pos' : 'var-neg';
      varEl.textContent = `${brl(cot.preco)} (${sinal}${cot.variacao.toFixed(2)}%)`;
    } else {
      varEl.className = 'dica';
      varEl.textContent = cot?.erro || 'Sem cotação B3';
    }

    header.append(tituloBox, varEl);

    const detalhes = document.createElement('div');
    detalhes.className = 'ativo-detalhes';
    detalhes.innerHTML = `
      <div><span>Qtd / PM</span><strong>${qtd} • ${brl(pm)}</strong></div>
      <div><span>Investido</span><strong>${brl(investido)}</strong></div>
      <div><span>Rende/mês</span><strong style="color:#059669">${brl(rendaMes)}</strong></div>
      <div><span>Divs. Recebidos</span><strong>${brl(divsRec)}</strong></div>
      <div><span>Atual na B3</span><strong>${temPreco ? brl(valorAtual) : '--'}</strong></div>
      <div><span>Retorno Real</span><strong class="${retornoTotal >= 0 ? 'var-pos' : 'var-neg'}">${temPreco ? `${retornoTotal >= 0 ? '+' : ''}${brl(retornoTotal)} (${retornoPerc.toFixed(1)}%)` : brl(divsRec)}</strong></div>
    `;

    const acoes = document.createElement('div');
    acoes.className = 'ativo-acoes';

    const btnComprar = document.createElement('button');
    btnComprar.className = 'btn-comprar';
    btnComprar.textContent = '+ Comprar';
    btnComprar.onclick = () => abrirModalCompra(a);

    const btnDiv = document.createElement('button');
    btnDiv.className = 'btn-div';
    btnDiv.textContent = '+ Dividendo';
    btnDiv.onclick = () => abrirModalDiv(a);

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-apagar';
    btnDel.textContent = 'X';
    btnDel.onclick = () => excluirAtivo(a.id, a.ticker);

    acoes.append(btnComprar, btnDiv, btnDel);
    card.append(header, detalhes, acoes);
    container.appendChild(card);
  });
}

// === COACH DE INVESTIMENTOS (ANÁLISE DIÁRIA) ===
function gerarAnaliseCoach() {
  const box = document.getElementById('coach-diagnostico');
  box.innerHTML = '';

  if (ativos.length === 0) {
    box.innerHTML = '<p class="dica">Cadastre pelo menos 1 ação ou FII para receber análises personalizadas.</p>';
    return;
  }

  const dicas = [];
  let totalInvestido = 0, totalFIIs = 0, totalAcoes = 0;

  ativos.forEach((a) => {
    const val = Number(a.quantidade) * Number(a.preco_medio);
    totalInvestido += val;
    if (a.tipo === 'FII') totalFIIs += val;
    else totalAcoes += val;
  });

  // 1. Oportunidades na própria carteira (Abaixo do Preço Médio ou queda no dia)
  ativos.forEach((a) => {
    const cot = cotacoes[a.ticker];
    const pm = Number(a.preco_medio);
    if (cot && typeof cot.preco === 'number') {
      if (cot.preco < pm * 0.99) {
        const desc = (((pm - cot.preco) / pm) * 100).toFixed(1);
        dicas.push({
          classe: 'dica-oportunidade',
          texto: `📉 ${a.ticker} está ${desc}% abaixo do seu Preço Médio (${brl(cot.preco)} vs seu PM de ${brl(pm)}). Aportar hoje reduz seu preço médio e aumenta seu Yield na carteira.`
        });
      } else if (cot.variacao <= -1.5) {
        dicas.push({
          classe: 'dica-oportunidade',
          texto: `⚡ ${a.ticker} caiu ${cot.variacao.toFixed(2)}% hoje na B3 (${brl(cot.preco)}). Vale observar se faz sentido reforçar posição.`
        });
      }
    }
  });

  // 2. Risco de concentração
  ativos.forEach((a) => {
    const peso = totalInvestido > 0 ? ((Number(a.quantidade) * Number(a.preco_medio)) / totalInvestido) * 100 : 0;
    if (peso > 30 && ativos.length > 1) {
      dicas.push({
        classe: 'dica-alerta',
        texto: `⚠️ Concentração alta: ${peso.toFixed(0)}% do seu dinheiro está em ${a.ticker}. Para proteger sua meta, tente direcionar os próximos aportes para outros ativos.`
      });
    }
  });

  // 3. Equilíbrio Ações vs FIIs
  const percFII = totalInvestido > 0 ? (totalFIIs / totalInvestido) * 100 : 0;
  if (percFII > 80) {
    dicas.push({
      classe: '',
      texto: `⚖️ Sua carteira está com ${percFII.toFixed(0)}% em FIIs e ${(100 - percFII).toFixed(0)}% em Ações. Ações sólidas pagadoras de dividendos (como bancos e elétricas) ajudam a crescer sua renda acima da inflação.`
    });
  } else if (percFII < 20) {
    dicas.push({
      classe: '',
      texto: `⚖️ Você tem ${(100 - percFII).toFixed(0)}% em Ações e ${percFII.toFixed(0)}% em FIIs. Bons FIIs ajudam a dar previsibilidade de renda caindo todo mês na sua meta.`
    });
  }

  // 4. Acelerador de Meta com o aporte do mês
  const melhorYield = [...ativos].sort((a, b) => {
    const ya = Number(a.preco_medio) > 0 ? Number(a.dividendo_mensal_cota) / Number(a.preco_medio) : 0;
    const yb = Number(b.preco_medio) > 0 ? Number(b.dividendo_mensal_cota) / Number(b.preco_medio) : 0;
    return yb - ya;
  })[0];

  if (melhorYield) {
    const y = Number(melhorYield.preco_medio) > 0
      ? (Number(melhorYield.dividendo_mensal_cota) / Number(melhorYield.preco_medio))
      : 0;
    const ganhoExtra = Number(config.meta_aporte_mensal) * y;
    if (ganhoExtra > 0) {
      dicas.push({
        classe: 'dica-oportunidade',
        texto: `🚀 Acelerador de Meta: se você aportar sua meta do mês (${brl(config.meta_aporte_mensal)}) em um ativo rendendo como ${melhorYield.ticker} (${(y * 100).toFixed(2)}% a.m.), sua renda mensal sobe cerca de +${brl(ganhoExtra)}/mês imediatamente.`
      });
    }
  }

  if (dicas.length === 0) {
    dicas.push({
      classe: '',
      texto: '✅ Sua carteira está bem equilibrada! Toque em "Analisar Carteira & Radar Hoje" para verificar as cotações do dia na B3.'
    });
  }

  dicas.forEach((d) => {
    const div = document.createElement('div');
    div.className = `dica-card ${d.classe}`;
    div.textContent = d.texto;
    box.appendChild(div);
  });
}

// === RADAR DE EMPRESAS CONFIÁVEIS ===
function renderizarRadar() {
  const container = document.getElementById('lista-radar');
  container.innerHTML = '';

  const lista = config.radar_tickers || [];
  lista.forEach((ticker) => {
    const cot = cotacoes[ticker];
    const temPreco = cot && typeof cot.preco === 'number';

    let emDesconto = false;
    let infoFaixa = 'Toque em "Analisar" para buscar B3';

    if (temPreco) {
      const sinal = cot.variacao >= 0 ? '+' : '';
      infoFaixa = `${brl(cot.preco)} (${sinal}${cot.variacao.toFixed(2)}% hoje)`;

      if (cot.min52 && cot.max52 && cot.max52 > cot.min52) {
        const posAno = ((cot.preco - cot.min52) / (cot.max52 - cot.min52)) * 100;
        if (posAno <= 25 || cot.variacao <= -1.5) emDesconto = true;
        infoFaixa += ` • Mín/Máx ano: ${brl(cot.min52)} - ${brl(cot.max52)}`;
      } else if (cot.variacao <= -1.5) {
        emDesconto = true;
      }
    } else if (cot?.erro) {
      infoFaixa = cot.erro;
    }

    const item = document.createElement('div');
    item.className = `radar-item ${emDesconto ? 'radar-desconto' : ''}`;

    const esq = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = ticker;
    const sub = document.createElement('div');
    sub.className = 'dica';
    sub.textContent = infoFaixa;

    esq.append(titulo, sub);

    if (emDesconto) {
      const badge = document.createElement('span');
      badge.className = 'badge-desconto';
      badge.textContent = '🔥 EM DESCONTO / PERTO DA MÍNIMA';
      esq.appendChild(badge);
    }

    const btnX = document.createElement('button');
    btnX.className = 'btn-x';
    btnX.textContent = '✕';
    btnX.onclick = () => removerDoRadar(ticker);

    item.append(esq, btnX);
    container.appendChild(item);
  });
}

document.getElementById('form-radar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = document.getElementById('radar-ticker').value.trim().toUpperCase();
  if (!t) return;

  const atual = new Set(config.radar_tickers || []);
  atual.add(t);
  config.radar_tickers = Array.from(atual);

  await setDoc(doc(db, 'config', 'metas'), { radar_tickers: config.radar_tickers }, { merge: true });
  e.target.reset();
  renderizarRadar();
});

async function removerDoRadar(ticker) {
  config.radar_tickers = (config.radar_tickers || []).filter((t) => t !== ticker);
  await setDoc(doc(db, 'config', 'metas'), { radar_tickers: config.radar_tickers }, { merge: true });
  renderizarRadar();
}

// === HISTÓRICOS ===
function renderizarHistoricos() {
  const ulAportes = document.getElementById('lista-aportes');
  ulAportes.innerHTML = '';
  if (aportesMes.length === 0) {
    ulAportes.innerHTML = '<li style="color:#64748b">Nenhum aporte registrado neste mês.</li>';
  } else {
    aportesMes.forEach((ap) => {
      const li = document.createElement('li');
      const e = document.createElement('span');
      e.textContent = `${ap.ticker} (${ap.tipo})`;
      const d = document.createElement('strong');
      d.textContent = brl(ap.valor);
      li.append(e, d);
      ulAportes.appendChild(li);
    });
  }

  const ulDivs = document.getElementById('lista-dividendos');
  ulDivs.innerHTML = '';
  if (dividendosMes.length === 0) {
    ulDivs.innerHTML = '<li style="color:#64748b">Nenhum dividendo lançado neste mês.</li>';
  } else {
    dividendosMes.forEach((dv) => {
      const li = document.createElement('li');
      const e = document.createElement('span');
      e.textContent = dv.ticker;
      const d = document.createElement('strong');
      d.style.color = '#059669';
      d.textContent = `+ ${brl(dv.valor)}`;
      li.append(e, d);
      ulDivs.appendChild(li);
    });
  }
}

// === FORMULÁRIOS E MODAIS ===
document.getElementById('form-ativo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticker = document.getElementById('ativo-ticker').value.trim().toUpperCase();
  const tipo = document.getElementById('ativo-tipo').value;
  const quantidade = Number(document.getElementById('ativo-qtd').value);
  const preco_medio = Number(document.getElementById('ativo-pm').value);
  const dividendo_mensal_cota = Number(document.getElementById('ativo-div').value);
  const contarAporte = document.getElementById('ativo-contar-aporte').checked;

  await addDoc(collection(db, 'ativos'), {
    ticker,
    tipo,
    quantidade,
    preco_medio,
    dividendo_mensal_cota,
    dividendos_recebidos: 0,
    created_at: Date.now()
  });

  if (contarAporte) {
    await addDoc(collection(db, 'aportes'), {
      ticker,
      tipo,
      valor: quantidade * preco_medio,
      mes_referencia: mesReferencia,
      created_at: Date.now()
    });
  }

  e.target.reset();
  await carregarDados();
  mudarAba('carteira', document.querySelectorAll('.nav-btn')[1]);
});

document.getElementById('form-metas').addEventListener('submit', async (e) => {
  e.preventDefault();
  const meta_renda_mensal = Number(document.getElementById('input-meta-renda').value);
  const meta_aporte_mensal = Number(document.getElementById('input-meta-aporte').value);
  const brapi_token = document.getElementById('input-brapi-token').value.trim();

  await setDoc(doc(db, 'config', 'metas'), {
    meta_renda_mensal,
    meta_aporte_mensal,
    brapi_token
  }, { merge: true });

  alert('Configurações salvas!');
  carregarDados();
});

function abrirModalCompra(ativo) {
  document.getElementById('compra-id').value = ativo.id;
  document.getElementById('modal-titulo').textContent = `Comprar ${ativo.ticker}`;
  document.getElementById('compra-qtd').value = '';
  document.getElementById('compra-preco').value = ativo.preco_medio;
  document.getElementById('compra-div').value = ativo.dividendo_mensal_cota;
  document.getElementById('modal-compra').classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('modal-compra').classList.add('hidden');
}

document.getElementById('form-compra').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('compra-id').value;
  const qtdNova = Number(document.getElementById('compra-qtd').value);
  const precoPago = Number(document.getElementById('compra-preco').value);
  const divNovo = Number(document.getElementById('compra-div').value);

  const ativo = ativos.find((a) => a.id === id);
  if (!ativo) return;

  const valorCompra = qtdNova * precoPago;
  const totalQtd = Number(ativo.quantidade) + qtdNova;
  const novoPM = ((Number(ativo.quantidade) * Number(ativo.preco_medio)) + valorCompra) / totalQtd;

  await updateDoc(doc(db, 'ativos', id), {
    quantidade: totalQtd,
    preco_medio: Number(novoPM.toFixed(2)),
    dividendo_mensal_cota: divNovo
  });

  await addDoc(collection(db, 'aportes'), {
    ticker: ativo.ticker,
    tipo: ativo.tipo,
    valor: valorCompra,
    mes_referencia: mesReferencia,
    created_at: Date.now()
  });

  fecharModal();
  carregarDados();
});

function abrirModalDiv(ativo) {
  document.getElementById('div-ativo-id').value = ativo.id;
  document.getElementById('modal-div-titulo').textContent = `Dividendo de ${ativo.ticker}`;
  document.getElementById('div-valor').value = '';
  document.getElementById('modal-dividendo').classList.remove('hidden');
}

function fecharModalDiv() {
  document.getElementById('modal-dividendo').classList.add('hidden');
}

document.getElementById('form-dividendo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('div-ativo-id').value;
  const valor = Number(document.getElementById('div-valor').value);
  const ativo = ativos.find((a) => a.id === id);
  if (!ativo || valor <= 0) return;

  const novoTotalDiv = Number(ativo.dividendos_recebidos || 0) + valor;

  await updateDoc(doc(db, 'ativos', id), {
    dividendos_recebidos: novoTotalDiv
  });

  await addDoc(collection(db, 'dividendos'), {
    ticker: ativo.ticker,
    valor,
    mes_referencia: mesReferencia,
    created_at: Date.now()
  });

  fecharModalDiv();
  carregarDados();
});

async function excluirAtivo(id, ticker) {
  if (!confirm(`Remover ${ticker} da carteira?`)) return;
  await deleteDoc(doc(db, 'ativos', id));
  carregarDados();
}

function mudarAba(nome, btn) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.remove('active'));
  document.getElementById(`tab-${nome}`).classList.add('active');
  btn.classList.add('active');
}

function filtrarTipo(tipo, btn) {
  filtroAtual = tipo;
  document.querySelectorAll('.filtro-btn').forEach((el) => el.classList.remove('active'));
  btn.classList.add('active');
  renderizarCarteira();
}

window.mudarAba = mudarAba;
window.filtrarTipo = filtrarTipo;
window.fecharModal = fecharModal;
window.fecharModalDiv = fecharModalDiv;
window.atualizarCotacoesECoach = atualizarCotacoesECoach;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

carregarDados();