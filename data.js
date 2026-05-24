/*
 * data.js
 * 役割: 外部JSONの読み込みと、OCRテキストのヒラメキ照合
 *       グローバル変数としてcharacterData・sharedData・hiramekiShinSections等を保持
 * 依存: なし（fetchはブラウザ標準API）
 * 被依存: ui.js（hiramekiShinSections・hiramekiKakureSectionsを参照）
 *         app.js（loadDataFiles・matchHiramekiを呼び出す）
 *
 * グローバル変数一覧:
 *   DATA_BASE              - GitHubのデータ取得先URL
 *   characterData          - キャラクターJSON格納オブジェクト
 *   sharedData             - 共用カードJSON格納オブジェクト
 *   hiramekiEffects        - 後方互換用フラット辞書（IDをキー・テキストを値）
 *   hiramekiShinSections   - 神ヒラメキリストのセクション構造
 *   hiramekiKakureSections - 隠ヒラメキリストのセクション構造（★のみ）
 *   ocrDict                - OCR誤認識対策辞典（カード効果テキスト用）
 *   panelDict              - 右パネル専用OCR辞典（説明テキスト全文収録）2026-05-24追加
 * 更新: 2026-05-24 18:05
 */

const DATA_BASE = 'https://raw.githubusercontent.com/A-zorro/-/main/data/';
let characterData  = {};
let sharedData     = {};
let hiramekiEffects = {};
let hiramekiShinSections  = [];
let hiramekiKakureSections = [];
let ocrDict  = { corrections: {}, terms: [] };
let panelDict = { terms: [] }; // 右パネル専用OCR辞典 2026-05-24追加

function debugLog(msg) {
  ['debugPanelGlobal', 'debugPanel'].forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.textContent += msg + '\n';
  });
  console.log(msg);
}

async function loadDataFiles() {
  debugLog('[start] loadDataFiles開始');
  try {
    debugLog('[fetch] manifest / ヒラメキリスト / OCR辞典 fetch開始');
    const [manifestRes, shinRes, kakureRes, ocrRes, panelDictRes] = await Promise.all([
      fetch(DATA_BASE + 'manifest.json'),
      fetch(DATA_BASE + encodeURIComponent('神ヒラメキリスト.json')),
      fetch(DATA_BASE + encodeURIComponent('隠ヒラメキリスト.json')),
      fetch(DATA_BASE + encodeURIComponent('OCR辞典.json')),
      fetch(DATA_BASE + encodeURIComponent('OCR辞典-panel.json')),
    ]);
    debugLog(`[fetch] manifest: ${manifestRes.status} / shin: ${shinRes.status} / kakure: ${kakureRes.status} / ocr: ${ocrRes.status} / panel: ${panelDictRes.status}`);
    const manifest = await manifestRes.json();
    const shinJson   = shinRes.ok   ? await shinRes.json()   : { sections: [] };
    const kakureJson = kakureRes.ok ? await kakureRes.json() : { sections: [] };
    hiramekiShinSections   = shinJson.sections   || [];
    hiramekiKakureSections = kakureJson.sections || [];
    hiramekiEffects = {};
    for (const sec of hiramekiShinSections) {
      for (const grp of (sec.groups || [])) {
        for (const [id, text] of Object.entries(grp.entries || {})) {
          hiramekiEffects[id] = text;
        }
      }
    }
    ocrDict   = await ocrRes.json();
    panelDict = panelDictRes.ok ? await panelDictRes.json() : { terms: [] };
    debugLog(`[panelDict] terms数: ${panelDict.terms.length}`);

    window._sharedManifest = (manifest.shared || []).map(e =>
      (typeof e === 'string') ? { id: e, name: e } : e
    );
    debugLog(`[manifest] characters: ${JSON.stringify(manifest.characters)}`);
    debugLog(`[manifest] shared: ${JSON.stringify(manifest.shared)}`);

    await Promise.all(manifest.characters.map(async entry => {
      const id   = (typeof entry === 'string') ? entry : entry.id;
      const name = (typeof entry === 'string') ? entry : entry.name;
      const res = await fetch(DATA_BASE + encodeURIComponent(id + '.json'));
      debugLog(`[chara] ${name}: ${res.status}`);
      if (res.ok) {
        characterData[name] = await res.json();
      } else {
        debugLog(`[chara] SKIP ${name} → 404（ファイル名確認要）`);
      }
    }));

    if (manifest.shared && manifest.shared.length > 0) {
      await Promise.all(manifest.shared.map(async entry => {
        const id   = (typeof entry === 'string') ? entry : entry.id;
        const url = DATA_BASE + encodeURIComponent(id + '.json');
        debugLog(`[shared] fetch: ${id}`);
        const res = await fetch(url);
        debugLog(`[shared] ${id}: ${res.status}`);
        if (res.ok) {
          sharedData[id] = await res.json();
          const cardCount = Object.keys(sharedData[id].cards || {}).length;
          debugLog(`[shared] ${id} カード数: ${cardCount}`);
        } else {
          debugLog(`[shared] ERROR ${id} → ${res.status} ${res.statusText}`);
        }
      }));
    } else {
      debugLog('[shared] manifest.sharedが空またはなし');
    }

    debugLog(`[完了] キャラ: ${Object.keys(characterData).length}人 / 共用: ${Object.keys(sharedData).length}ファイル`);
    dataReady = true;

    const loadingMsg = document.getElementById('dataLoadingMsg');
    if (loadingMsg) loadingMsg.style.display = 'none';

    if (results.length > 0 || Object.keys(currentBlocks).length > 0) {
      renderConfirmCards(currentBlocks, false);
    }
  } catch (e) {
    debugLog(`[ERROR] ${e.message}\n${e.stack}`);
    console.warn('データ読み込みエラー（照合機能は限定動作）:', e);
    dataReady = true;
    const loadingMsg = document.getElementById('dataLoadingMsg');
    if (loadingMsg) loadingMsg.style.display = 'none';
  }
}
loadDataFiles();

/* ============================================================
   OCR正規化・照合ロジック
   normalizeOCR・getBigrams・similarity・matchHiramekiの4関数。
   元々app.jsに重複していたが、data.jsに統合した。
   ui.jsのrenderConfirmCards内からmatchHirameki・normalizeOCR・similarityが参照される。
   更新: 2026-05-20 22:03
============================================================ */
function normalizeOCR(text) {
  let result = text || '';
  for (const [wrong, correct] of Object.entries(ocrDict.corrections || {})) {
    result = result.replaceAll(wrong, correct);
  }
  result = result.replace(/、/g, '');
  return result.replace(/\s+/g, '');
}

function getBigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  const ba = getBigrams(a), bb = getBigrams(b);
  if (ba.size === 0 && bb.size === 0) return 1;
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of ba) { if (bb.has(g)) inter++; }
  return inter / (ba.size + bb.size - inter);
}

// mode引数追加: 2026-05-20 22:47
function matchHirameki(ocrEffectText, ocrKind, mode) {
  const norm = normalizeOCR(ocrEffectText);
  const candidates = [];
  const effectValues = Object.values(hiramekiEffects);

  if (mode === 'shared') {
    for (const [fileName, fileData] of Object.entries(sharedData)) {
      for (const [cardName, card] of Object.entries(fileData.cards || {})) {
        const baseNorm = normalizeOCR(card.baseEffect);
        let bestScore = similarity(norm, baseNorm);
        for (const addEffect of effectValues) {
          const combined = normalizeOCR(card.baseEffect + addEffect);
          const s = similarity(norm, combined);
          if (s > bestScore) bestScore = s;
        }
        if (ocrKind && card.kind === ocrKind) bestScore = Math.min(1, bestScore + 0.1);
        candidates.push({ charName: fileName, cardKey: cardName, cardName: card.name, hiramekiNum: null, score: bestScore, isX6: false, effect: card.baseEffect, cost: card.cost, kind: card.kind });
      }
      for (const [cardName, card] of Object.entries(fileData.arenaCards || {})) {
        const baseNorm = normalizeOCR(card.baseEffect);
        let bestScore = similarity(norm, baseNorm);
        for (const addEffect of effectValues) {
          const combined = normalizeOCR(card.baseEffect + addEffect);
          const s = similarity(norm, combined);
          if (s > bestScore) bestScore = s;
        }
        if (ocrKind && card.kind === ocrKind) bestScore = Math.min(1, bestScore + 0.1);
        candidates.push({ charName: fileName, cardKey: cardName, cardName: card.name, hiramekiNum: null, score: bestScore, isX6: false, effect: card.baseEffect, cost: card.cost, kind: card.kind });
      }
    }
  } else {
    for (const [charName, charData] of Object.entries(characterData)) {
      if (!charData.cards) continue;
      for (const [cardKey, card] of Object.entries(charData.cards)) {
        if (!card.hirameki) continue;
        for (let n = 1; n <= 5; n++) {
          const h = card.hirameki[String(n)];
          if (!h) continue;
          const hiramekiKind = h.kind || card.kind;
          const baseNorm = normalizeOCR(h.effect);
          let bestScore = similarity(norm, baseNorm);
          for (const addEffect of effectValues) {
            const combined = normalizeOCR(h.effect + addEffect);
            const s = similarity(norm, combined);
            if (s > bestScore) bestScore = s;
          }
          if (ocrKind && hiramekiKind === ocrKind) bestScore = Math.min(1, bestScore + 0.1);
          candidates.push({ charName, cardKey, cardName: card.name, hiramekiNum: n, score: bestScore, isX6: false, effect: h.effect, cost: h.cost, kind: hiramekiKind });
        }
        const baseNorm = normalizeOCR(card.baseEffect);
        let bestX6 = similarity(norm, baseNorm);
        for (const addEffect of effectValues) {
          const combined = normalizeOCR(card.baseEffect + addEffect);
          const s = similarity(norm, combined) * 0.9;
          if (s > bestX6) bestX6 = s;
        }
        if (ocrKind && card.kind === ocrKind) bestX6 = Math.min(1, bestX6 + 0.1);
        candidates.push({ charName, cardKey, cardName: card.name, hiramekiNum: 6, score: bestX6, isX6: true, effect: card.baseEffect, cost: card.cost, kind: card.kind });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}
