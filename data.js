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
 * 更新: 2026-05-20 20:44
 */

const DATA_BASE = 'https://raw.githubusercontent.com/A-zorro/-/main/data/';
let characterData  = {}; // { キャラ名: { cards: {...} } }
let sharedData     = {}; // { 'K02-恒常コスト1': { cards: {...}, arenaCards: {...} } }
let hiramekiEffects = {}; // { '001-01': '効果テキスト', ... }（後方互換用・全エントリ）
let hiramekiShinSections  = []; // 神ヒラメキ用セクション構造
let hiramekiKakureSections = []; // 隠れヒラメキ用セクション構造（★のみ）
let ocrDict = { corrections: {}, terms: [] };

// デバッグログをdebugPanelGlobal（常時表示）とdebugPanel（STEP4内）の両方に出力する
// 更新: 2026-05-20 20:44
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
