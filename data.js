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
 *   ocrDict                - OCR誤認識対策辞典
 * 更新: 2026-05-19 17:53
 */

const DATA_BASE = 'https://raw.githubusercontent.com/A-zorro/-/main/data/';
let characterData  = {}; // { キャラ名: { cards: {...} } }
let sharedData     = {}; // { 'K02-恒常コスト1': { cards: {...}, arenaCards: {...} } }
let hiramekiEffects = {}; // { '001-01': '効果テキスト', ... }（後方互換用・全エントリ）
let hiramekiShinSections  = []; // 神ヒラメキ用セクション構造
let hiramekiKakureSections = []; // 隠れヒラメキ用セクション構造（★のみ）
let ocrDict = { corrections: {}, terms: [] };

function debugLog(msg) {
  const panel = document.getElementById('debugPanel');
  if (panel) panel.textContent += msg + '\n';
  console.log(msg);
}

async function loadDataFiles() {
  debugLog('[start] loadDataFiles開始');
  try {
    debugLog('[fetch] manifest / ヒラメキリスト / OCR辞典 fetch開始');
    const [manifestRes, shinRes, kakureRes, ocrRes] = await Promise.all([
      fetch(DATA_BASE + 'manifest.json'),
      fetch(DATA_BASE + encodeURIComponent('神ヒラメキリスト.json')),
      fetch(DATA_BASE + encodeURIComponent('隠ヒラメキリスト.json')),
      fetch(DATA_BASE + encodeURIComponent('OCR辞典.json')),
    ]);
    debugLog(`[fetch] manifest: ${manifestRes.status} / shin: ${shinRes.status} / kakure: ${kakureRes.status} / ocr: ${ocrRes.status}`);
    const manifest = await manifestRes.json();
    const shinJson   = shinRes.ok   ? await shinRes.json()   : { sections: [] };
    const kakureJson = kakureRes.ok ? await kakureRes.json() : { sections: [] };
    hiramekiShinSections   = shinJson.sections   || [];
    hiramekiKakureSections = kakureJson.sections || [];
    // 後方互換：全エントリをフラット辞書にも展開
    hiramekiEffects = {};
    for (const sec of hiramekiShinSections) {
      for (const grp of (sec.groups || [])) {
        for (const [id, text] of Object.entries(grp.entries || {})) {
          hiramekiEffects[id] = text;
        }
      }
    }
    ocrDict = await ocrRes.json();
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

    // shared JSON読み込み
    if (manifest.shared && manifest.shared.length > 0) {
      await Promise.all(manifest.shared.map(async name => {
        const url = DATA_BASE + encodeURIComponent(name + '.json');
        debugLog(`[shared] fetch: ${name}`);
        const res = await fetch(url);
        debugLog(`[shared] ${name}: ${res.status}`);
        if (res.ok) {
          sharedData[name] = await res.json();
          const cardCount = Object.keys(sharedData[name].cards || {}).length;
          debugLog(`[shared] ${name} カード数: ${cardCount}`);
        } else {
          debugLog(`[shared] ERROR ${name} → ${res.status} ${res.statusText}`);
        }
      }));
    } else {
      debugLog('[shared] manifest.sharedが空またはなし');
    }

    debugLog(`[完了] キャラ: ${Object.keys(characterData).length}人 / 共用: ${Object.keys(sharedData).length}ファイル`);
    dataReady = true;

    // ローディング表示を消す
    const loadingMsg = document.getElementById('dataLoadingMsg');
    if (loadingMsg) loadingMsg.style.display = 'none';

    // テキストファイルが先に読み込まれていた場合は再レンダリング（ヒラメキタブ依存バグ修正）
    if (Object.keys(currentBlocks).length > 0) {
      renderConfirmCards(currentBlocks, false);
    }
  } catch (e) {
    debugLog(`[ERROR] ${e.message}\n${e.stack}`);
    console.warn('データ読み込みエラー（照合機能は限定動作）:', e);
    dataReady = true; // エラー時もフラグを立てて処理を止めない
    const loadingMsg = document.getElementById('dataLoadingMsg');
    if (loadingMsg) loadingMsg.style.display = 'none';
  }
}
loadDataFiles();

/* ============================================================
   OCR正規化・照合ロジック
============================================================ */
function normalizeOCR(text) {
  let result = text || '';
  // 誤認識テーブルで直接置換
  for (const [wrong, correct] of Object.entries(ocrDict.corrections || {})) {
    result = result.replaceAll(wrong, correct);
  }
  // 句読点（、）を除外して照合する
  // 理由：ゲーム画像に「、」がない箇所にClaudeが勝手に補完したテキストが
  // JSONやPDFに混入している可能性があるため、比較時のみ除外して精度を保つ。
  // 記録テキスト自体は変更しない。
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

function matchHirameki(ocrEffectText, ocrKind) {
  const norm = normalizeOCR(ocrEffectText);
  const candidates = [];

  // ヒラメキリストの全効果テキストリスト（組み合わせ用）
  const effectValues = Object.values(hiramekiEffects);

  if (cardMode === 'shared') {
    // ── 共用版：sharedDataのbaseEffectと照合 ──
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
    // ── キャラ版：characterDataのhiramekiと照合 ──
    for (const [charName, charData] of Object.entries(characterData)) {
      if (!charData.cards) continue;
      for (const [cardKey, card] of Object.entries(charData.cards)) {
        if (!card.hirameki) continue;
        for (let n = 1; n <= 5; n++) {
          const h = card.hirameki[String(n)];
          if (!h) continue;
          const hiramekiKind = h.kind || card.kind;
          const baseNorm = normalizeOCR(h.effect);

          // ① ベース効果単体のスコア
          let bestScore = similarity(norm, baseNorm);

          // ② ベース効果＋追加効果の組み合わせで最高スコアを探す
          for (const addEffect of effectValues) {
            const combined = normalizeOCR(h.effect + addEffect);
            const s = similarity(norm, combined);
            if (s > bestScore) bestScore = s;
          }

          // 種別一致ボーナス
          if (ocrKind && hiramekiKind === ocrKind) bestScore = Math.min(1, bestScore + 0.1);

          candidates.push({ charName, cardKey, cardName: card.name, hiramekiNum: n, score: bestScore, isX6: false, effect: h.effect, cost: h.cost, kind: hiramekiKind });
        }

        // X-6：基本効果と比較
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
