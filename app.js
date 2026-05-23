/*
 * app.js
 * 役割: ユーザー操作のエントリーポイントと全体フロー制御
 * 依存: cost.js（cropCostCanvas・detectCostColor・matchCostDigitTemplate・detectCostDigitを使用）
 *       data.js（loadDataFiles・matchHirameki・normalizeOCRを使用）
 *       ui.js（renderResultList・renderCostList・renderConfirmCards・makeHpanelTrigger等を使用）
 *       index.htmlのwindowグローバル変数（results・confirmItems・currentBlocks・dataReady・shortcutRawText）
 * 被依存: なし（最終段）
 *
 * 【重要】index.htmlの<script>タグ内に関数があるとブロックスコープに閉じてしまい、
 * ui.js等の外部JSから参照できない。全関数をこのファイルに移してグローバルスコープに出している。
 * 更新: 2026-05-20 00:04
 */

// setCardMode()はSTEP G実装に伴い削除（2026-05-20 22:47）
// カード単位のモード切り替えはui.jsのrenderConfirmCards内のボタンで行う

function setPattern(mode) {
  patternMode = mode;
  document.getElementById('btnAuto').classList.toggle('active', mode === 'auto');
  document.getElementById('btnP2').classList.toggle('active',   mode === 'p2');
  document.getElementById('btnP1').classList.toggle('active',   mode === 'p1');
} // { canvas, winner, scoreDiff }

/* ============================================================
   画像読み込み・一括処理
============================================================ */
async function handleFiles(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  results = [];
  const resultSection = document.getElementById('resultSection');
  const resultList    = document.getElementById('resultList');

  resultSection.style.display = 'block';

  // 1枚ずつ処理するたびに進捗を更新する
  // 「N/M枚を処理中...」の形式で何枚目かを表示してユーザーの待機ストレスを軽減
  // 更新: 2026-05-22 08:44
  for (let i = 0; i < files.length; i++) {
    resultList.innerHTML = `<div class="processing">⏳ ${i + 1}/${files.length}枚を処理中...</div>`;
    const result = await processFile(files[i], i + 1);
    results.push(result);
  }

  renderResultList();
  renderCostList();
  document.getElementById('costSection').style.display = 'block';
  document.getElementById('mergeSection').style.display = 'block';
  document.getElementById('resetSection').style.display = 'block';

  // 画像選択だけでSTEP4まで自動表示する（一気通貫）
  // shortcutLoadedはloadShortcutFile()でも表示されるが、
  // 画像のみモードでも表示が必要なためここでも設定する。
  // txtを後から読み込んだ場合はloadShortcutFile()が上書きするため競合しない。
  // 更新: 2026-05-20 22:03
  document.getElementById('shortcutLoaded').style.display = 'block';
  document.getElementById('shortcutFileName').textContent = '';

  if (dataReady) {
    renderConfirmCards(currentBlocks, false);
  } else {
    // JSON読み込み中の場合はローディング表示
    // loadDataFiles()完了時にrenderConfirmCardsが自動実行される（data.js参照）
    document.getElementById('dataLoadingMsg').style.display = 'block';
  }
  document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function processFile(file, index) {
  // ファイル読み込み
  const dataUrl = await new Promise(r => {
    const reader = new FileReader();
    reader.onload = ev => r(ev.target.result);
    reader.readAsDataURL(file);
  });
  const img = await new Promise(r => {
    const i = new Image();
    i.onload = () => r(i);
    i.src = dataUrl;
  });

  // パターン判定
  const pattern = patternMode === 'auto' ? detectPattern(img) : patternMode;
  const cropKey = pattern === 'p2' ? CROP_P2 : CROP_P1;

  // 神様識別
  const canvas = cropToCanvas(img, cropKey);
  const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const { winner, sorted, scoreDiff } = identifyGod(imageData);

  // コスト識別（p2のみ）
  let costDigit = null, costTmpl = null, costFeat = null, costColor = null, costCanvas = null;
  if (pattern === 'p2') {
    costCanvas = cropCostCanvas(img);
    const costData = costCanvas.getContext('2d').getImageData(0, 0, 50, 60);
    costColor = detectCostColor(costData);

    // テンプレマッチング優先 → 失敗時に特徴点検出フォールバック
    const tmplResult  = matchCostDigitTemplate(costCanvas, costColor);
    const featResult  = detectCostDigit(costCanvas, costColor);
    let rawDigit = tmplResult ?? featResult ?? null;

    costDigit = rawDigit;
    costTmpl  = tmplResult;
    costFeat  = featResult;
  }

  // カード名領域クロップ（p2のみ・絶対座標）
  let nameCanvas = null;
  if (pattern === 'p2') {
    nameCanvas = document.createElement('canvas');
    nameCanvas.width = 300; nameCanvas.height = 480;
    nameCanvas.getContext('2d').drawImage(img, 530, 140, 300, 480, 0, 0, 300, 480);
  }

  // OCR用フル画像Canvas（p2のみ）
  // runOCR()がOCR_REGION_NAME/EFFECTの絶対座標で切り抜くために必要。
  // r.canvas（神様アイコンクロップ）は小さすぎてx=580等の座標が範囲外になるため別途保持。
  // P1は不要なのでnullのまま。メモリ節約のためP2のみ生成する。
  // 更新: 2026-05-23 21:52
  let fullCanvas = null;
  if (pattern === 'p2') {
    fullCanvas = document.createElement('canvas');
    fullCanvas.width  = img.naturalWidth;
    fullCanvas.height = img.naturalHeight;
    fullCanvas.getContext('2d').drawImage(img, 0, 0);
  }

  return { index, canvas, winner, scoreDiff, sorted,
           costDigit, costTmpl, costFeat, costColor, costCanvas, nameCanvas,
           fullCanvas, isP2: pattern === 'p2' };
}

// 16:9判定（パターン2）かそれ以外（パターン1）
function detectPattern(img) {
  const ratio = img.naturalWidth / img.naturalHeight;
  return (ratio > 1.6 && ratio < 1.9) ? 'p2' : 'p1';
}

function cropToCanvas(img, crop) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const sx = Math.floor(crop.x1 * W);
  const sy = Math.floor(crop.y1 * H);
  const sw = Math.max(1, Math.floor((crop.x2 - crop.x1) * W));
  const sh = Math.max(1, Math.floor((crop.y2 - crop.y1) * H));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/* ============================================================
   神様識別（最近傍距離方式）
============================================================ */
function identifyGod(imageData) {
  const pixels = imageData.data;
  const sums = {}, counts = {};
  for (const name of GOD_NAMES) { sums[name] = 0; counts[name] = 0; }

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i+3] < 128) continue;
    const px = [pixels[i], pixels[i+1], pixels[i+2]];
    for (const [name, colors] of Object.entries(GOD_RGB)) {
      let minD = Infinity;
      for (const c of colors) {
        const d = Math.sqrt((px[0]-c[0])**2 + (px[1]-c[1])**2 + (px[2]-c[2])**2);
        if (d < minD) minD = d;
      }
      sums[name] += minD;
      counts[name]++;
    }
  }

  const avgDists = {};
  for (const name of GOD_NAMES) {
    avgDists[name] = counts[name] > 0 ? sums[name] / counts[name] : Infinity;
  }

  const sorted    = Object.entries(avgDists).sort((a,b) => a[1]-b[1]);
  const scoreDiff = sorted[1][1] - sorted[0][1];
  return { winner: sorted[0][0], sorted, scoreDiff };
}

/* ============================================================
   結果リスト描画
============================================================ */

/* ============================================================
   コスト確認リスト描画（STEP 3）
============================================================ */


/* ============================================================
   テキスト合成
============================================================ */
function parseShortcutText(raw) {
  // 「===next===」を区切りとしてブロック分割
  const blocks = {};
  const parts = raw.split(/===next===/);
  parts.forEach(part => {
    const lines = part.split('\n').map(l => l.trim()).filter(l => l);
    if (!lines.length) return;

    // 「#N.」から番号を取得
    const numMatch = lines[0].match(/^#(\d+)\./);
    if (!numMatch) return;
    const num = parseInt(numMatch[1]);

    // ##==カード名・種別== と ##==カード効果・ヒラメキ== でセクション分割
    const nameIdx   = lines.findIndex(l => l.includes('カード名・種別'));
    const effectIdx = lines.findIndex(l => l.includes('カード効果・ヒラメキ'));

    const nameLines   = (nameIdx   >= 0 && effectIdx > nameIdx)   ? lines.slice(nameIdx + 1,   effectIdx) : [];
    const effectLines = (effectIdx >= 0)                           ? lines.slice(effectIdx + 1)            : [];

    blocks[num] = { nameLines, effectLines };
  });
  return blocks;
}

function isNoiseChar(ch) {
  // ひらがな・カタカナ・漢字・英数字・一般的な記号以外 = ノイズ文字
  return !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEFa-zA-Z0-9（）「」【】［］\[\]()、。・＋\-!！?？0-9０-９]/.test(ch);
}

function extractGodEffect(lines) {
  if (!lines.length) return { mainLines: lines, godEffect: null };
  const last = lines[lines.length - 1];
  if (last && last.length > 1 && isNoiseChar(last[0])) {
    return {
      mainLines: lines.slice(0, -1),
      godEffect: last.slice(1).trim()
    };
  }
  return { mainLines: lines, godEffect: null };
}

// txtなしルートを許容するためガードを削除。
// shortcutRawTextが空の場合、currentBlocksも空になるため
// 照合なしカードのnameLines/effectLinesは出力されないが、
// JSON照合済みカードは正常に出力される。
// 更新: 2026-05-22 04:58
function mergeData() {
  const lines = [];
  const activeItems = confirmItems.filter(item => !item.excluded);

  activeItems.forEach((item, outputIdx) => {
    const r = results[item.resultIdx];
    const godName = r.winner === '通常ヒラメキ' ? '通常ヒラメキ' : r.winner;

    // コスト
    const digitEl = document.getElementById(`costDigit-${item.resultIdx}`);
    const colorEl = document.getElementById(`costColor-${item.resultIdx}`);
    const costDigitVal = (digitEl && digitEl.value) ? digitEl.value : '?';
    const costColorVal = (colorEl && colorEl.value) ? colorEl.value : '?';

    // JSON照合結果
    const selCharData = characterData[item.charName];
    const selCard     = selCharData ? selCharData.cards[item.cardKey] : null;
    const isX6        = item.hiramekiNum === 6;
    const selHirameki = selCard && !isX6 ? selCard.hirameki[String(item.hiramekiNum)] : null;

    lines.push(`#${outputIdx + 1}.`);
    lines.push('##==神の名前==');
    lines.push(`【${godName}】`);
    lines.push('##==コスト==');
    lines.push(`${costDigitVal}/${costColorVal}`);

    // 共用版・キャラ版で出力フォーマットを分岐 2026-05-20 22:47
    if (item.mode === 'shared') {
      // ── 共用版出力 ──
      const sharedCardName = item.sharedCardName || '（未特定）';
      let sharedBaseEffect = '';
      for (const fileData of Object.values(sharedData)) {
        const c = (fileData.cards || {})[sharedCardName] || (fileData.arenaCards || {})[sharedCardName];
        if (c) { sharedBaseEffect = c.baseEffect; break; }
      }
      lines.push('##==カード名・種別==');
      lines.push(sharedCardName);
      if (sharedBaseEffect) {
        lines.push('##==カード効果・ヒラメキ==');
        lines.push(sharedBaseEffect);
      }
      if (item.kakureEffect && item.kakureEffect !== '－') {
        lines.push('##==通常ヒラメキ==');
        lines.push(hiramekiEffects[item.kakureEffect] || item.kakureEffect);
      }
      if (godName !== '通常ヒラメキ' && item.shinEffect && item.shinEffect !== '－') {
        lines.push('##==神ヒラメキ追加効果==');
        lines.push(hiramekiEffects[item.shinEffect] || item.shinEffect);
      }
    } else if (selCard) {
      // ── キャラ版出力 ──
      lines.push('##==キャラクター==');
      lines.push(item.charName);
      lines.push('##==カード==');
      lines.push(`${item.cardKey} / ${selCard.name} / コスト${isX6 ? selCard.cost : selHirameki?.cost ?? '?'} / ${selCard.kind} / ${item.cardKey}-${item.hiramekiNum}`);
      lines.push('##==ヒラメキ効果==');
      lines.push(isX6 ? selCard.baseEffect : (selHirameki?.effect ?? '（不明）'));
      if (isX6 && item.kakureEffect && item.kakureEffect !== '－') {
        lines.push('##==隠れヒラメキ追加効果==');
        lines.push(hiramekiEffects[item.kakureEffect] || item.kakureEffect);
      }
      if (godName !== '通常ヒラメキ' && item.shinEffect && item.shinEffect !== '－') {
        lines.push('##==神ヒラメキ追加効果==');
        lines.push(hiramekiEffects[item.shinEffect] || item.shinEffect);
      }
    } else {
      // 照合なし：OCRテキストをそのまま出力
      const block = currentBlocks[r.index];
      if (block) {
        lines.push('##==カード名・種別==');
        block.nameLines.forEach(l => lines.push(l));
        lines.push('##==カード効果・ヒラメキ==');
        const { mainLines, godEffect } = extractGodEffect(block.effectLines);
        mainLines.forEach(l => lines.push(l));
        if (godEffect) lines.push(`→ ${godEffect}`);
      }
    }

    lines.push('===next===');
  });

  const merged = lines.join('\n');
  document.getElementById('mergePreview').textContent = merged;
  document.getElementById('mergeResult').style.display = 'block';
  document.getElementById('mergeResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyMerged() {
  const text = document.getElementById('mergePreview').textContent;
  writeToClipboard(text, 'mergeCopyBtn', '📋 コピー');
}

// ファイル名を「YYYY年MM月DD日-N件合体.txt」の形式で動的生成する
// 件数は除外済みitem（excluded=true）を除いたactiveItemsの数
// 更新: 2026-05-22 06:50
function saveMerged() {
  const text = document.getElementById('mergePreview').textContent;
  const now = new Date();
  const y  = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const count = confirmItems.filter(item => !item.excluded).length;
  const filename = `${y}年${mo}月${d}日-${count}件合体.txt`;
  downloadText(text, filename);
}

/* ============================================================
   共通ユーティリティ
============================================================ */
function writeToClipboard(text, btnId, defaultLabel) {
  navigator.clipboard.writeText(text).then(() => {
    flashBtn(btnId, '✅ コピーしました！', defaultLabel);
  }).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    flashBtn(btnId, '✅ コピーしました！', defaultLabel);
  });
}

function flashBtn(btnId, msg, defaultLabel) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.textContent = msg;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = defaultLabel;
    btn.classList.remove('copied');
  }, 2000);
}

// Share APIのtitleを削除して余計な「テキスト.txt」生成を防ぐ。
// titleなしで問題が再発する場合はfallbackDownloadに落ちる構造を維持。
// 更新: 2026-05-22 07:46
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'text/plain' });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] })
        .catch(e => { if (e.name !== 'AbortError') fallbackDownload(blob, filename); });
      return;
    }
  }
  fallbackDownload(blob, filename);
}

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   リセット
============================================================ */
function resetTool() {
  results = [];
  confirmItems = [];
  currentBlocks = {};
  shortcutRawText = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('shortcutFile').value = '';
  document.getElementById('resultSection').style.display  = 'none';
  document.getElementById('costSection').style.display    = 'none';
  document.getElementById('mergeSection').style.display   = 'none';
  document.getElementById('resetSection').style.display   = 'none';
  document.getElementById('mergeResult').style.display    = 'none';
  document.getElementById('shortcutLoaded').style.display = 'none';
  document.getElementById('confirmTableArea').style.display = 'none';
  document.getElementById('confirmCards').innerHTML = '';
  document.getElementById('resultList').innerHTML = '';
  document.getElementById('costList').innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   OCR処理（Tesseract.js）
   前処理なし・元画像のままで認識精度が最良と判明しているため加工なし。
   カード名・種別領域とカード効果領域の2箇所を固定座標で切り抜いて認識する。
   結果はparseShortcutText()と同じ形式でcurrentBlocksに格納し、
   renderConfirmCards()をそのまま利用する。
   更新: 2026-05-22 08:57
============================================================ */

// OCR用固定切り抜き座標（p2パターン・絶対値）
// ショートカットアプリと同じ座標を使用
const OCR_REGION_NAME   = { x: 580, y: 120, w: 255, h: 100 }; // カード名・種別
const OCR_REGION_EFFECT = { x: 517, y: 300, w: 318, h: 320 }; // カード効果・ヒラメキ

// 画像から指定領域を切り抜いてCanvasを返す
// region: { x, y, w, h }（絶対座標）
// img: HTMLImageElement
function cropRegion(img, region) {
  const c = document.createElement('canvas');
  c.width = region.w; c.height = region.h;
  c.getContext('2d').drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  return c;
}

// 全結果画像に対してOCRを実行し、currentBlocksに格納してSTEP4を再描画する
// p2パターン以外の画像はスキップする
// 更新: 2026-05-22 08:57
async function runOCR() {
  // 診断用：関数の呼び出し自体を最初に記録
  // p2Resultsが空の場合などの早期リターンでもログが残るようにするため先頭に配置
  // 更新: 2026-05-23 21:52
  debugLog(`[OCR] runOCR開始 results=${results.length}`);

  if (!results.length) {
    debugLog('[OCR] 早期リターン: 画像未選択');
    alert('先に画像を選択してね！');
    return;
  }

  const btn = document.getElementById('ocrBtn');
  btn.disabled = true;
  btn.textContent = '⏳ OCR処理中...';

  const p2Results = results.filter(r => r.isP2);
  debugLog(`[OCR] p2Results=${p2Results.length} / 全results=${results.length} isP2一覧=${JSON.stringify(results.map(r => r.isP2))}`);

  if (!p2Results.length) {
    debugLog('[OCR] 早期リターン: P2画像なし');
    alert('p2パターン（詳細画面フルスクショ）の画像がないよ！');
    btn.disabled = false;
    btn.textContent = '🔍 OCRで読み取る';
    return;
  }

  for (let i = 0; i < p2Results.length; i++) {
    const r = p2Results[i];
    btn.textContent = `⏳ OCR ${i + 1}/${p2Results.length}枚処理中...`;

    // r.fullCanvas（フル画像Canvas）から直接OCR領域を絶対座標で切り抜く
    // r.canvas は神様アイコン用の小さなクロップCanvas なのでOCR座標(x=580等)が範囲外になる
    // processFile()でP2のみfullCanvasを保存するよう修正済み（2026-05-23 21:52）
    if (!r.fullCanvas) {
      debugLog(`[OCR] SKIP index:${r.index} fullCanvasがnull（P1画像の可能性）`);
      continue;
    }

    const nameCanvas   = document.createElement('canvas');
    nameCanvas.width   = OCR_REGION_NAME.w;
    nameCanvas.height  = OCR_REGION_NAME.h;
    nameCanvas.getContext('2d').drawImage(
      r.fullCanvas,
      OCR_REGION_NAME.x, OCR_REGION_NAME.y, OCR_REGION_NAME.w, OCR_REGION_NAME.h,
      0, 0, OCR_REGION_NAME.w, OCR_REGION_NAME.h
    );

    const effectCanvas   = document.createElement('canvas');
    effectCanvas.width   = OCR_REGION_EFFECT.w;
    effectCanvas.height  = OCR_REGION_EFFECT.h;
    effectCanvas.getContext('2d').drawImage(
      r.fullCanvas,
      OCR_REGION_EFFECT.x, OCR_REGION_EFFECT.y, OCR_REGION_EFFECT.w, OCR_REGION_EFFECT.h,
      0, 0, OCR_REGION_EFFECT.w, OCR_REGION_EFFECT.h
    );

    debugLog(`[OCR] index:${r.index} fullCanvas=${r.fullCanvas.width}x${r.fullCanvas.height} → Tesseract呼び出し`);

    try {
      const [nameRes, effectRes] = await Promise.all([
        Tesseract.recognize(nameCanvas,   'jpn', { tessedit_pageseg_mode: '6' }),
        Tesseract.recognize(effectCanvas, 'jpn', { tessedit_pageseg_mode: '6' }),
      ]);

      const nameText   = (nameRes.data.text   || '').trim();
      const effectText = (effectRes.data.text || '').trim();

      debugLog(`[OCR] index:${r.index} name="${nameText}" effect="${effectText}"`);

      // parseShortcutText()と同じ形式でcurrentBlocksに格納
      // nameLines: カード名・種別行、effectLines: 効果テキスト行
      currentBlocks[r.index] = {
        nameLines:   nameText.split('\n').map(l => l.trim()).filter(l => l),
        effectLines: effectText.split('\n').map(l => l.trim()).filter(l => l),
      };
      debugLog(`[OCR] currentBlocks[${r.index}] nameLines=${JSON.stringify(currentBlocks[r.index].nameLines)} effectLines=${JSON.stringify(currentBlocks[r.index].effectLines)}`);
    } catch (e) {
      debugLog(`[OCR] エラー index:${r.index} ${e.message}`);
    }
  }

  btn.disabled = false;
  btn.textContent = '🔍 OCRで読み取る';

  // STEP4を再描画（OCR結果を反映）
  if (dataReady) {
    renderConfirmCards(currentBlocks, false);
  }
}

/* ============================================================
   拡大モーダル
============================================================ */
function showModal(srcCanvas) {
  const zoom = document.getElementById('zoomCanvas');
  zoom.width  = srcCanvas.width;
  zoom.height = srcCanvas.height;
  zoom.getContext('2d').drawImage(srcCanvas, 0, 0);
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
