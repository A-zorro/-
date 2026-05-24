/*
 * ui.js
 * 役割: 各STEPのUI描画とヒラメキ選択パネルの制御
 * 依存: data.js（hiramekiShinSections・hiramekiKakureSections・hiramekiEffectsを参照）
 *       index.htmlのwindowグローバル変数（results・confirmItems・currentBlocks・
 *       dataReady・patternMode・shortcutRawTextを参照。letではなくwindow宣言が必要な理由は
 *       index.html内のコメントを参照）
 * 被依存: app.js（render系関数・パネル関数を呼び出す）
 *
 * 注意: hpanelOpen/hpanelClose/_hpanelSelectはグローバルスコープに定義されているため
 *       HTML内のonclick属性から直接呼び出し可能。
 *       ただしrenderConfirmCards内部のネスト関数として定義されているため、
 *       このファイル内での位置に注意（renderConfirmCards内に存在する）。
 * 更新: 2026-05-20 00:04
 */

function renderCostList() {
  const list = document.getElementById('costList');
  list.innerHTML = '';

  const DC = { '0':'#FFFFFF','1':'#FFFF00','2':'#FF7F00','3':'#FF0000',
               '4':'#FF00FF','5':'#7F00FF','6':'#0000FF','7':'#007FFF',
               '8':'#00FFFF','9':'#00FF00','X':'#7FFF00','Ø':'#969696' };
  const COLOR_STATES = [
    { value:'青_normal', kanji:'青', en:'normal', color:'#007FFF' },
    { value:'赤_up',     kanji:'赤', en:'up',     color:'#FF0000' },
    { value:'緑_down',   kanji:'緑', en:'down',   color:'#00FF00' },
  ];

  results.forEach((r, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:10px;background:#333;border-radius:10px;border:1px solid #444;margin-bottom:8px;';

    // 番号 + ヒント行
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    const num = document.createElement('div');
    num.style.cssText = 'font-size:13px;font-weight:700;color:#888;width:22px;text-align:center;flex-shrink:0;';
    num.textContent = r.index;
    header.appendChild(num);

    if (r.isP2) {
      const hint = document.createElement('div');
      hint.className = 'cost-check';
      const tm = r.costTmpl ?? '-', ft = r.costFeat ?? '-';
      hint.innerHTML =
        `テンプレ:<span style="color:${tm!=='-'?'#7eb8d4':'#555'};margin-left:3px">${tm}</span>` +
        `&nbsp;|&nbsp;特徴点:<span style="color:${ft!=='-'?'#a78bfa':'#555'};margin-left:3px">${ft}</span>`;
      header.appendChild(hint);
    }
    wrap.appendChild(header);

    if (!r.isP2) {
      wrap.insertAdjacentHTML('beforeend','<div style="font-size:11px;color:#555;font-style:italic;padding-left:30px;">切り抜きモード（コスト判別なし）</div>');
      list.appendChild(wrap);
      return;
    }

    // 5列3行グリッド
    const grid = document.createElement('div');
    grid.className = 'cost-grid';

    // [0,0] プレビューcanvas
    const prev = document.createElement('canvas');
    prev.className = 'cost-preview-cell';
    prev.width = 50; prev.height = 60;
    if (r.costCanvas) prev.getContext('2d').drawImage(r.costCanvas, 0, 0);
    grid.appendChild(prev);

    // 初期選択: テンプレ優先→特徴点→null
    // ※自動識別結果が4以上の場合は0として扱う（processFile側でも同様の処理済み）
    let selDigit = r.costTmpl ?? r.costFeat ?? null;
    // colorIdxをupdateDispより前に定義（TDZ回避）
    let colorIdx = Math.max(0, COLOR_STATES.findIndex(s => s.value === r.costColor));

    // [1,0] 数字表示セル
    const digitDisp = document.createElement('div');
    digitDisp.className = 'cost-digit-display';
    digitDisp.style.gridRow = '2'; digitDisp.style.gridColumn = '1';
    function updateDisp() {
      const d = selDigit ?? '?';
      const c = COLOR_STATES[colorIdx].color;
      digitDisp.innerHTML = `<span>${d}</span>`;
      digitDisp.style.color = c;
      digitDisp.style.borderColor = selDigit ? c : '#444';
      const inp = document.getElementById(`costDigit-${idx}`);
      if (inp) inp.value = selDigit ?? '';
    }
    grid.appendChild(digitDisp);

    // [2,0] 色トグルセル
    const colorToggle = document.createElement('div');
    colorToggle.className = 'cost-color-toggle';
    colorToggle.style.gridRow = '3'; colorToggle.style.gridColumn = '1';
    // btnsとDIGITSをupdateColorより先に定義
    const DIGITS = ['0','1','2','3','4','5','6','7','8','9','X','Ø'];
    const btns = {};

    function updateColor() {
      const s = COLOR_STATES[colorIdx];
      colorToggle.style.borderColor = s.color;
      colorToggle.style.color = s.color;
      colorToggle.innerHTML = `<span class="cjk">${s.kanji}</span><span class="eng">${s.en}</span>`;
      const inp = document.getElementById(`costColor-${idx}`);
      if (inp) inp.value = s.value;
      // 表示セルも色状態に合わせて更新
      updateDisp();
      // 選択ボタンの枠も更新
      Object.values(btns).forEach(b => {
        if (b.classList.contains('selected')) b.style.borderColor = s.color;
      });
    }
    updateColor();
    colorToggle.addEventListener('click', () => {
      colorIdx = (colorIdx + 1) % COLOR_STATES.length;
      updateColor();
    });
    grid.appendChild(colorToggle);

    // 数字ボタン 0-3(row1), 4-7(row2), 8-9-X-Ø(row3)
    DIGITS.forEach((d, di) => {
      const btn = document.createElement('button');
      const midDigits  = new Set(['4','5','6','7']);
      const darkDigits = new Set(['8','9','X','Ø']);
      const brightnessClass = midDigits.has(d) ? ' dc-mid' : darkDigits.has(d) ? ' dc-dark' : '';
      btn.className = 'digit-btn' + brightnessClass;
      btn.style.gridRow  = String(Math.floor(di/4)+1);
      btn.style.gridColumn = String((di%4)+2);
      btn.innerHTML = `<span>${d}</span>`;
      if (d === selDigit) {
        btn.classList.add('selected');
        btn.style.borderColor = COLOR_STATES[colorIdx].color;
      }
      btn.addEventListener('click', () => {
        Object.values(btns).forEach(b => {
          b.classList.remove('selected');
          b.style.borderColor = '#444';
        });
        btn.classList.add('selected');
        btn.style.borderColor = COLOR_STATES[colorIdx].color;
        selDigit = d;
        updateDisp();
      });
      btns[d] = btn;
      grid.appendChild(btn);
    });

    wrap.appendChild(grid);

    // 隠しinput（mergeData用）
    const hd = document.createElement('input');
    hd.type='hidden'; hd.id=`costDigit-${idx}`; hd.value=selDigit??'';
    const hc = document.createElement('input');
    hc.type='hidden'; hc.id=`costColor-${idx}`; hc.value=COLOR_STATES[colorIdx].value;
    wrap.appendChild(hd); wrap.appendChild(hc);

    list.appendChild(wrap);
  });
}
function renderResultList() {
  const list = document.getElementById('resultList');
  list.innerHTML = '';

  results.forEach((r, idx) => {
    const isLow = r.scoreDiff < 3.0;
    const div = document.createElement('div');
    div.className = `result-item${isLow ? ' low-conf' : ''}`;

    // プレビューcanvas
    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'item-preview';
    previewCanvas.width  = r.canvas.width;
    previewCanvas.height = r.canvas.height;
    previewCanvas.getContext('2d').drawImage(r.canvas, 0, 0);
    previewCanvas.onclick = () => showModal(r.canvas);

    // セレクト
    const select = document.createElement('select');
    select.className = 'item-select';
    applyGodStyle(select, r.winner);
    // 神様6種 + 通常ヒラメキ
    [...GOD_NAMES, '通常ヒラメキ'].forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name === '通常ヒラメキ' ? '🟡 通常ヒラメキ' : name;
      if (name === r.winner) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      results[idx].winner = select.value;
      applyGodStyle(select, select.value);
    });

    // 信頼度
    const conf = document.createElement('div');
    conf.className = `item-conf${isLow ? ' warn' : ''}`;
    conf.textContent = isLow
      ? `⚠ スコア差${r.scoreDiff.toFixed(2)}（要目視確認）`
      : `✓ スコア差${r.scoreDiff.toFixed(2)}`;

    const body = document.createElement('div');
    body.className = 'item-body';
    body.appendChild(select);
    body.appendChild(conf);

    const num = document.createElement('div');
    num.className = 'item-num';
    num.textContent = r.index;

    div.appendChild(num);
    div.appendChild(previewCanvas);
    div.appendChild(body);
    list.appendChild(div);
  });
}

/* ============================================================
   ショートカットファイル読み込み
============================================================ */
// shortcutRawTextはindex.htmlでwindow.shortcutRawTextとして宣言 2026-05-20 22:47

function loadShortcutFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    shortcutRawText = ev.target.result;
    document.getElementById('shortcutFileName').textContent = `📄 ${file.name} を読み込んだよ！`;
    document.getElementById('shortcutLoaded').style.display = 'block';
    document.getElementById('mergeResult').style.display    = 'none';
    currentBlocks = parseShortcutText(shortcutRawText);

    if (dataReady) {
      // JSON読み込み済み → 即レンダリング
      document.getElementById('dataLoadingMsg').style.display = 'none';
      renderConfirmCards(currentBlocks);
    } else {
      // JSON未完了 → ローディング表示して待機（loadDataFiles完了時に自動レンダリング）
      document.getElementById('dataLoadingMsg').style.display = 'block';
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/* ============================================================
   照合カード描画
============================================================ */
const GOD_COLORS = {
  ディアロス: '#F3BA88', セクレド: '#78DEC1', キルケン: '#E5B1FA',
  ニヒルム: '#86CDF4', ヴィトル: '#AB9180', '@?#$': '#6020E0', 通常ヒラメキ: '#fbbf24',
};

function applyGodStyle(el, godName) {
  const color = GOD_COLORS[godName] || '#888888';
  el.style.borderColor = color;
  el.style.color = color;
}

function renderConfirmCards(blocks, preserveItems) {
  if (!preserveItems) {
    // mode: 'character' | 'shared' - カードごとのモード 2026-05-20 22:47
    confirmItems = results.map((_, idx) => ({
      resultIdx: idx, excluded: false, mode: 'character',
      charName: null, cardKey: null, hiramekiNum: null,
      kakureEffect: null, shinEffect: null, matchScore: 0,
      sharedCardName: null, sharedFileId: null // 共用版カテゴリID 2026-05-20 23:44
    }));
  }

  const container = document.getElementById('confirmCards');
  container.innerHTML = '';

  confirmItems.forEach((item, pos) => {
    const r = results[item.resultIdx];
    const block = blocks[r.index];
    const ocrEffect = block ? block.effectLines.join('\n') : '';

    // 右パネルOCR結果（panelTerms）を取得。未取得・P1画像の場合は空配列
    // extractPanelTerms()でノイズ除去済みの専門用語リスト
    // 2026-05-24追加
    const panelTerms = block?.panelTerms || [];

    // OCRテキストから種別を抽出
    const ocrKindRaw = block ? block.nameLines.find(l => ['攻撃','スキル','強化'].includes(l.trim())) : null;
    const ocrKind = ocrKindRaw ? ocrKindRaw.trim() : null;

    // 照合実行（panelTermsをスコア補正に使用）2026-05-24追加
    const matches = matchHirameki(ocrEffect, ocrKind, item.mode, panelTerms);
    const top = matches[0] || null;

    // 神様（auto-selectionより前に定義）
    const godName  = r.winner;
    const godColor = GOD_COLORS[godName] || '#888';
    const hasGod   = godName !== '通常ヒラメキ';

    // 初回のみ自動選択
    if (!preserveItems && top) {
      item.charName    = top.charName;
      item.cardKey     = top.cardKey;
      item.hiramekiNum = top.hiramekiNum;
      item.matchScore  = top.score;
      // 共用版：照合結果のカード名をsharedCardNameに自動反映
      if (item.mode === 'shared' && !item.sharedCardName) {
        item.sharedCardName = top.cardKey;
      }

      // 余り効果を照合（神ヒラメキ・隠れヒラメキの自動候補）
      const baseNorm = normalizeOCR(top.effect);
      const ocrNorm  = normalizeOCR(ocrEffect);
      // ベース効果を除いた残りテキストを生成
      const remainder = ocrNorm.replace(baseNorm, '').trim();
      if (remainder.length > 1) {
        let bestKey = null, bestScore = 0;
        const keywords = window.hiramekiKeywords || {};
        for (const [key, val] of Object.entries(hiramekiEffects)) {
          // バイグラム類似度スコア
          const bigramScore = similarity(remainder, normalizeOCR(val));

          // キーワードマッチングスコア
          // remainderにkeywordsが含まれる数に応じてスコア加算
          // 1キーワードあたり+0.05、最大+0.3
          // 更新: 2026-05-24 23:30
          let keywordScore = 0;
          const grpKeywords = keywords[key] || [];
          if (grpKeywords.length > 0) {
            for (const kw of grpKeywords) {
              if (remainder.includes(kw)) keywordScore += 0.05;
            }
            keywordScore = Math.min(keywordScore, 0.3);
          }

          const s = bigramScore + keywordScore;
          if (s > bestScore) { bestScore = s; bestKey = key; }
        }
        if (bestKey && bestScore > 0.15) {
          if (top.isX6) {
            item.kakureEffect = bestKey;
          } else if (hasGod) {
            item.shinEffect = bestKey;
          } else if (item.mode === 'shared') {
            // 共用版の通常ヒラメキ（神なし）
            item.kakureEffect = bestKey;
          }
        }
      }
    }

    // コスト情報
    const digitEl   = document.getElementById(`costDigit-${item.resultIdx}`);
    const colorEl   = document.getElementById(`costColor-${item.resultIdx}`);
    const costDigit = (digitEl && digitEl.value) ? digitEl.value : '?';
    const costColor = (colorEl && colorEl.value) ? colorEl.value : '?';

    // 現在選択中のカード情報
    const selCharData = characterData[item.charName];
    const selCard     = selCharData ? selCharData.cards[item.cardKey] : null;
    const selHirameki = selCard ? selCard.hirameki[String(item.hiramekiNum)] : null;
    const isX6        = item.hiramekiNum === 6;

    // 整形済みテキスト
    let formattedText = '';
    if (item.mode === 'shared') {
      const block = currentBlocks[r.index];
      const sharedCardName = item.sharedCardName || (block && block.nameLines[0]) || '（未取得）';
      // sharedDataからbaseEffectを取得
      let sharedBaseEffect = '';
      for (const fileData of Object.values(sharedData)) {
        const c = (fileData.cards || {})[sharedCardName] || (fileData.arenaCards || {})[sharedCardName];
        if (c) { sharedBaseEffect = c.baseEffect; break; }
      }
      const lines = [`カード: ${sharedCardName}`];
      if (sharedBaseEffect) lines.push(sharedBaseEffect);
      if (item.kakureEffect && item.kakureEffect !== '－') {
        lines.push(`通常ヒラメキ: ${item.kakureEffect} / ${hiramekiEffects[item.kakureEffect] || item.kakureEffect}`);
      }
      if (hasGod && item.shinEffect && item.shinEffect !== '－') {
        lines.push('');
        lines.push(`[神] ${hiramekiEffects[item.shinEffect] || item.shinEffect}`);
      }
      formattedText = lines.join('\n');
    } else if (selCard && selHirameki) {
      const hiramekiKind = selHirameki.kind || selCard.kind;
      const lines = [
        `${item.charName} / ${item.cardKey} / ${selCard.name}`,
        `コスト${selHirameki.cost} / ${hiramekiKind} / ${item.cardKey}-${item.hiramekiNum}`,
        '',
        selHirameki.effect,
      ];
      if (isX6 && item.kakureEffect && item.kakureEffect !== '－') {
        lines.push('');
        lines.push(`[隠れ] ${hiramekiEffects[item.kakureEffect] || item.kakureEffect}`);
      }
      if (hasGod && item.shinEffect && item.shinEffect !== '－') {
        lines.push('');
        lines.push(`[神] ${hiramekiEffects[item.shinEffect] || item.shinEffect}`);
      }
      formattedText = lines.join('\n');
    } else if (selCard && isX6) {
      const lines = [
        `${item.charName} / ${item.cardKey} / ${selCard.name}`,
        `コスト${selCard.cost} / ${selCard.kind} / ${item.cardKey}-6（隠れヒラメキ）`,
        '',
        selCard.baseEffect,
      ];
      if (item.kakureEffect && item.kakureEffect !== '－') {
        lines.push('');
        lines.push(`[隠れ] ${hiramekiEffects[item.kakureEffect] || item.kakureEffect}`);
      }
      if (hasGod && item.shinEffect && item.shinEffect !== '－') {
        lines.push('');
        lines.push(`[神] ${hiramekiEffects[item.shinEffect] || item.shinEffect}`);
      }
      formattedText = lines.join('\n');
    } else {
      formattedText = '（照合結果なし）\n\n' + ocrEffect;
    }

    // 適合率スコア
    const score = Math.round((item.matchScore || 0) * 100);
    const scoreClass = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';

    // ── カード全体 ──
    const card = document.createElement('div');
    card.className = 'match-card' + (item.excluded ? ' excluded' : '');

    // ── モード切り替えボタン（キャラ版 / 共用版）── 2026-05-20 22:47
    const modeToggle = document.createElement('div');
    modeToggle.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    const btnChar = document.createElement('button');
    btnChar.textContent = '🎭 キャラ版';
    btnChar.style.cssText = `flex:1;padding:5px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:${item.mode==='character'?'2px solid #78DEC1':'1px solid #444'};background:${item.mode==='character'?'rgba(120,222,193,0.15)':'transparent'};color:${item.mode==='character'?'#78DEC1':'#666'};`;
    btnChar.onclick = () => { item.mode = 'character'; renderConfirmCards(currentBlocks, true); };
    const btnShared = document.createElement('button');
    btnShared.textContent = '🃏 共用版';
    btnShared.style.cssText = `flex:1;padding:5px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:${item.mode==='shared'?'2px solid #fbbf24':'1px solid #444'};background:${item.mode==='shared'?'rgba(251,191,36,0.15)':'transparent'};color:${item.mode==='shared'?'#fbbf24':'#666'};`;
    btnShared.onclick = () => { item.mode = 'shared'; renderConfirmCards(currentBlocks, true); };
    modeToggle.appendChild(btnChar);
    modeToggle.appendChild(btnShared);
    card.appendChild(modeToggle);

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'match-card-header';
    header.innerHTML = `
      <span class="match-score ${scoreClass}">適合率 ${score}%</span>
      <span class="match-num">#${pos + 1}</span>
    `;
    card.appendChild(header);

    // 画像＋テキスト
    const body = document.createElement('div');
    body.className = 'match-body';

    // 画像セル（カード全面）
    const imgCell = document.createElement('div');
    imgCell.className = 'match-image-cell';
    const srcCanvas = r.nameCanvas || r.canvas;
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width  = srcCanvas.width;
    previewCanvas.height = srcCanvas.height;
    previewCanvas.style.cssText = 'width:100%;height:auto;border-radius:4px;border:1px solid #444;background:#000;image-rendering:pixelated;cursor:pointer;max-width:130px;';
    previewCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);
    previewCanvas.onclick = () => showModal(srcCanvas);
    imgCell.appendChild(previewCanvas);

    // テキストセル
    const textCell = document.createElement('div');
    textCell.className = 'match-text-cell';

    // 神様表示（色付き）
    const godSpan = document.createElement('div');
    godSpan.style.cssText = `font-size:11px;font-weight:700;color:${godColor};margin-bottom:4px;`;
    godSpan.textContent = hasGod ? `【${godName}】` : '🟡 通常ヒラメキ';
    textCell.appendChild(godSpan);

    // コスト表示
    const costColorHex = costColor === '赤_up' ? '#f87171' : costColor === '緑_down' ? '#34d399' : '#7eb8d4';
    const costSpan = document.createElement('div');
    costSpan.style.cssText = `font-size:10px;color:${costColorHex};margin-bottom:6px;font-family:'Rajdhani',sans-serif;font-weight:700;`;
    costSpan.textContent = `コスト ${costDigit} / ${costColor.split('_')[0]}`;
    textCell.appendChild(costSpan);

    // 整形済みテキスト
    const textPre = document.createElement('div');
    textPre.style.cssText = 'font-size:10px;color:#ccc;white-space:pre-wrap;word-break:break-all;';
    textPre.textContent = formattedText;
    textCell.appendChild(textPre);

    body.appendChild(imgCell);
    body.appendChild(textCell);
    card.appendChild(body);

    // ── ドロップダウン群 ──
    const selects = document.createElement('div');
    selects.className = 'match-selects';

    // ヘルパー：select行を作る（キャラ版・共用版共通）
    if (item.mode === 'shared') {
      // ── 共用カード版（2段階選択：ファイル→カード名）── 2026-05-20 23:44

      // 1段目：ファイル選択（manifest.sharedのname表示・id管理）
      const sharedFileOptions = [['', '（カテゴリ未選択）'],
        ...window._sharedManifest.map(e => [e.id, e.name])];
      const { row: fileRow } = makeSelectRow(
        '⬜ カテゴリ', sharedFileOptions, item.sharedFileId || '',
        false,
        val => {
          item.sharedFileId = val || null;
          item.sharedCardName = null; // カテゴリ変更時にカード選択をリセット
          renderConfirmCards(currentBlocks, true);
        }
      );
      selects.appendChild(fileRow);

      // 2段目：選択中ファイル内のカード名
      const selectedFileData = item.sharedFileId ? sharedData[item.sharedFileId] : null;
      const fileCards = selectedFileData
        ? [...Object.keys(selectedFileData.cards || {}),
           ...Object.keys(selectedFileData.arenaCards || {})]
        : [];
      const block = currentBlocks[r.index];
      const autoName = block && block.nameLines[0] ? block.nameLines[0] : '';
      const nameOptions = [['', '（未特定）'], ...fileCards.map(n => [n, n])];
      const { row: nameRow } = makeSelectRow(
        '⬜ カード名', nameOptions, item.sharedCardName || autoName,
        !item.sharedFileId,
        val => { item.sharedCardName = val || null; renderConfirmCards(currentBlocks, true); }
      );
      selects.appendChild(nameRow);

      // 通常ヒラメキ（パネル選択）
      const { row: effectRow } = makeHpanelTrigger(
        '⬜ 通常ヒラメキ', hiramekiKakureSections,
        item.kakureEffect || null, false,
        id => { item.kakureEffect = id || null; renderConfirmCards(currentBlocks, true); }
      );
      selects.appendChild(effectRow);

      // 神ヒラメキ（パネル選択）
      const { row: shinRow } = makeHpanelTrigger(
        '⬜ 神ヒラメキ', hiramekiShinSections,
        hasGod ? (item.shinEffect || null) : null, !hasGod,
        id => { item.shinEffect = id || null; renderConfirmCards(currentBlocks, true); }
      );
      selects.appendChild(shinRow);

    } else {
      // ── キャラ版 ──

    // キャラクター選択
    const charOptions = [['', '（未特定）'], ...Object.keys(characterData).map(n => [n, n])];
    const { row: charRow, sel: charSel } = makeSelectRow(
      '⬜ キャラ', charOptions, item.charName || '',
      Object.keys(characterData).length === 0,
      val => {
        item.charName = val || null;
        item.cardKey = null; item.hiramekiNum = null;
        renderConfirmCards(currentBlocks, true);
      }
    );
    selects.appendChild(charRow);

    // カード選択
    const cardOptions = [['', '（未特定）']];
    if (selCharData) {
      Object.entries(selCharData.cards).forEach(([key, c]) => {
        cardOptions.push([key, `${key} / ${c.name}`]);
      });
    }
    const { row: cardRow, sel: cardSel } = makeSelectRow(
      '⬜ カード', cardOptions, item.cardKey || '',
      !selCharData,
      val => {
        item.cardKey = val || null; item.hiramekiNum = null;
        renderConfirmCards(currentBlocks, true);
      }
    );
    selects.appendChild(cardRow);

    // X番号選択
    const xOptions = [['', '（未特定）']];
    if (selCard) {
      for (let n = 1; n <= 5; n++) {
        if (selCard.hirameki[String(n)]) xOptions.push([String(n), `${item.cardKey}-${n}`]);
      }
      xOptions.push(['6', `${item.cardKey}-6（隠れヒラメキ）`]);
    }
    const { row: xRow, sel: xSel } = makeSelectRow(
      '⬜ ヒラメキ', xOptions, item.hiramekiNum ? String(item.hiramekiNum) : '',
      !selCard,
      val => {
        item.hiramekiNum = val ? parseInt(val) : null;
        renderConfirmCards(currentBlocks, true);
      }
    );
    selects.appendChild(xRow);

    // 隠れヒラメキ選択（X-6の時のみ有効・パネル）
    const showKakure = isX6;
    const { row: kakureRow } = makeHpanelTrigger(
      '⬜ 隠れヒラメキ', hiramekiKakureSections,
      showKakure ? (item.kakureEffect || null) : null, !showKakure,
      id => { item.kakureEffect = id || null; }
    );
    selects.appendChild(kakureRow);

    // 神ヒラメキ選択（神様ありの時のみ有効・パネル）
    const { row: shinRow } = makeHpanelTrigger(
      '⬜ 神ヒラメキ', hiramekiShinSections,
      hasGod ? (item.shinEffect || null) : null, !hasGod,
      id => { item.shinEffect = id || null; }
    );
    selects.appendChild(shinRow);

    } // end キャラ版 else

    card.appendChild(selects);

    // OCR生データ（折りたたみ）
    const ocrToggle = document.createElement('div');
    ocrToggle.className = 'match-ocr-toggle';
    ocrToggle.textContent = '▶ OCR生データ（タップで展開）';
    const ocrContent = document.createElement('div');
    ocrContent.className = 'match-ocr-content';
    // 効果テキスト・右パネル生テキスト・抽出語を表示
    // panelRawText: OCR生テキストそのまま（何が読めているか確認用）
    // panelTerms: panelDictと照合して抽出した専門用語リスト
    // 2026-05-24更新
    const panelRawText = block?.panelRawText || '';
    const panelRawLine = panelRawText
      ? '【右パネル生テキスト】\n' + panelRawText
      : '【右パネル生テキスト】（未取得）';
    const panelTermsLine = panelTerms.length > 0
      ? '【右パネル抽出語】' + panelTerms.join(' / ')
      : '【右パネル抽出語】（なし）';
    ocrContent.textContent = (ocrEffect || '（テキストなし）') + '\n\n' + panelRawLine + '\n\n' + panelTermsLine;
    ocrToggle.onclick = () => {
      const open = ocrContent.style.display === 'block';
      ocrContent.style.display = open ? 'none' : 'block';
      ocrToggle.textContent = (open ? '▶' : '▼') + ' OCR生データ（タップで展開）';
    };
    card.appendChild(ocrToggle);
    card.appendChild(ocrContent);

    // フッター（順番・除外）
    const footer = document.createElement('div');
    footer.className = 'match-footer';

    const orderBtns = document.createElement('div');
    orderBtns.className = 'match-order-btns';
    const btnUp = document.createElement('button');
    btnUp.className = 'match-order-btn';
    btnUp.textContent = '▲';
    btnUp.disabled = pos === 0;
    btnUp.onclick = () => {
      [confirmItems[pos], confirmItems[pos-1]] = [confirmItems[pos-1], confirmItems[pos]];
      renderConfirmCards(currentBlocks, true);
    };
    const btnDown = document.createElement('button');
    btnDown.className = 'match-order-btn';
    btnDown.textContent = '▼';
    btnDown.disabled = pos === confirmItems.length - 1;
    btnDown.onclick = () => {
      [confirmItems[pos], confirmItems[pos+1]] = [confirmItems[pos+1], confirmItems[pos]];
      renderConfirmCards(currentBlocks, true);
    };
    orderBtns.appendChild(btnUp);
    orderBtns.appendChild(btnDown);

    const btnExclude = document.createElement('button');
    btnExclude.className = 'match-exclude-btn' + (item.excluded ? ' active' : '');
    btnExclude.textContent = item.excluded ? '✕ 除外中' : '－ 除外';
    btnExclude.onclick = () => {
      item.excluded = !item.excluded;
      renderConfirmCards(currentBlocks, true);
    };

    footer.appendChild(orderBtns);
    footer.appendChild(btnExclude);
    card.appendChild(footer);

    container.appendChild(card);
  });

  document.getElementById('confirmTableArea').style.display = 'block';
}

/* ── ヒラメキ選択パネル（グローバルスコープ） ── */

// ── ヒラメキ選択パネル ──
let _hpanelCallback = null;
let _hpanelCurrent  = null;

// hpanelSearch()から参照するためにアクティブなsectionsを保持
// hpanelOpen()が呼ばれるたびに更新される
// 更新: 2026-05-20 20:44
let _hpanelActiveSections = null;

function hpanelOpen(titleText, sections, currentVal, onSelect) {
  _hpanelActiveSections = sections;
  _hpanelCallback = onSelect;
  _hpanelCurrent  = currentVal;
  document.getElementById('hpanelTitle').textContent = titleText;
  document.getElementById('hpanelSearch').value = '';
  _hpanelRender(sections, '');
  document.getElementById('hpanelOverlay').classList.add('open');
  // オーバーレイクリックで閉じる
  document.getElementById('hpanelOverlay').onclick = e => {
    if (e.target === document.getElementById('hpanelOverlay')) hpanelClose();
  };
  // 検索欄
  document.getElementById('hpanelSearch').oninput = function() {
    _hpanelRender(sections, this.value.trim());
  };
}

function hpanelClose() {
  document.getElementById('hpanelOverlay').classList.remove('open');
}

// index.htmlのoninput="hpanelSearch(this.value)"から呼び出されるフォールバック関数
// hpanelOpen()内のoninput上書きが優先されるが、パネルが開く前の呼び出しに備えて定義
// 更新: 2026-05-20 20:44
function hpanelSearch(val) {
  if (_hpanelActiveSections) _hpanelRender(_hpanelActiveSections, (val || '').trim());
}

function _hpanelEscRE(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _hpanelRender(sections, query) {
  const body = document.getElementById('hpanelBody');
  let html = '';

  // クリア行
  html += `<div class="hpanel-clear" onclick="_hpanelSelect(null)">− 選択を解除</div>`;

  if (query) {
    const q = query.toLowerCase();
    let count = 0;
    for (const sec of sections) {
      for (const grp of (sec.groups || [])) {
        for (const [id, text] of Object.entries(grp.entries || {})) {
          if (text.toLowerCase().includes(q)) {
            const hi = text.replace(new RegExp('(' + _hpanelEscRE(query) + ')', 'gi'), '<mark>$1</mark>');
            const sel = id === _hpanelCurrent ? ' selected' : '';
            html += `<div class="hpanel-entry${sel}" onclick="_hpanelSelect('${id}')">${hi}</div>`;
            count++;
          }
        }
      }
    }
    if (!count) html += '<div class="hpanel-noresult">該当なし</div>';
  } else {
    for (const sec of sections) {
      const total = (sec.groups || []).reduce((n, g) => n + Object.keys(g.entries || {}).length, 0);
      html += `<div class="hpanel-section" id="hpsec-${sec.id}">`;
      html += `<div class="hpanel-sec-hd" onclick="this.closest('.hpanel-section').classList.toggle('open')">`;
      html += `<span class="hpanel-sec-name">${sec.id} ${sec.name}</span>`;
      html += `<div class="hpanel-sec-meta"><span class="hpanel-sec-count">${total}件</span><span class="hpanel-sec-chev">▼</span></div>`;
      html += `</div><div class="hpanel-sec-body">`;
      for (const grp of (sec.groups || [])) {
        html += `<div class="hpanel-grp-label">${grp.name}</div>`;
        for (const [id, text] of Object.entries(grp.entries || {})) {
          const sel = id === _hpanelCurrent ? ' selected' : '';
          html += `<div class="hpanel-entry${sel}" onclick="_hpanelSelect('${id}')">${text}</div>`;
        }
      }
      html += `</div></div>`;
    }
  }
  body.innerHTML = html;
}

function _hpanelSelect(id) {
  hpanelClose();
  if (_hpanelCallback) _hpanelCallback(id);
}

function makeHpanelTrigger(label, sections, currentVal, disabled, onChange) {
  const row = document.createElement('div');
  row.className = 'match-select-row';
  const lbl = document.createElement('div');
  lbl.className = 'match-select-label';
  lbl.textContent = label;
  const btn = document.createElement('button');
  btn.className = 'hpanel-trigger' + (disabled ? ' disabled' : '');
  const valSpan = document.createElement('span');
  valSpan.className = 'hpanel-val';
  // 初期表示もidではなくテキストで表示する 2026-05-20 23:44
  valSpan.textContent = currentVal ? (_hpanelFindText(sections, currentVal) || currentVal) : '－';
  const arr = document.createElement('span');
  arr.className = 'hpanel-arr';
  arr.textContent = '▼';
  btn.appendChild(valSpan);
  btn.appendChild(arr);
  if (!disabled) {
    btn.onclick = () => {
      hpanelOpen(label, sections, _hpanelCurrent, id => {
        const text = id ? _hpanelFindText(sections, id) : '－';
        valSpan.textContent = text;
        onChange(id);
      });
      // 現在値を設定
      _hpanelCurrent = currentVal;
    };
  }
  row.appendChild(lbl);
  row.appendChild(btn);
  return { row, btn, valSpan };
}

function _hpanelFindText(sections, id) {
  for (const sec of sections) {
    for (const grp of (sec.groups || [])) {
      if (grp.entries && grp.entries[id]) return grp.entries[id];
    }
  }
  return id;
}

function makeSelectRow(label, options, selectedVal, disabled, onChange) {
  const row = document.createElement('div');
  row.className = 'match-select-row';
  const lbl = document.createElement('div');
  lbl.className = 'match-select-label';
  lbl.textContent = label;
  const sel = document.createElement('select');
  sel.className = 'match-select';
  sel.disabled = disabled;
  options.forEach(([val, text]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (val === selectedVal) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!disabled) sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(lbl);
  row.appendChild(sel);
  return { row, sel };
}

