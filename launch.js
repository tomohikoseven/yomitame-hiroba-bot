const { _android } = require('playwright');

/**
 * 設定値
 */
const CONFIG = {
    BRAVE_PKG: 'com.brave.browser',
    LIST_URL: 'https://hiroba-sp.yomu-point.jp/magazineList/',
    MAX_ARTICLES: 150,
    TAP_COORDS: {
        FIRST_ARTICLE: { x: 540, y: 1800 }
    },
    WAIT: {
        INITIAL_LOAD: 8000,
        ARTICLE_LOAD: 7000,
        STAMP_CARD_LOAD: 6000,
        NEXT_ARTICLE_LOAD: 8000,
        RETRY_LOAD: 10000,
        AFTER_SCROLL: 1500,
        AFTER_BUTTON_TAP: 4000
    }
};

/**
 * ユーティリティ
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function tap(device, x, y) {
    return await device.shell(`input tap ${x} ${y}`);
}

async function swipe(device, x1, y1, x2, y2, duration = 500) {
    return await device.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
}

async function keyEvent(device, code, meta = null) {
    const metaArg = meta ? `--meta ${meta} ` : '';
    return await device.shell(`input keyevent ${metaArg}${code}`);
}

async function inputText(device, text) {
    return await device.shell(`input text "${text}"`);
}

/**
 * 画面上の要素を探す（完全一致）
 */
async function findElement(device, text) {
    try {
        // ファイルを介さず、標準出力（/dev/tty）から直接XMLをダンプ
        const xmlBuffer = await device.shell('uiautomator dump /dev/tty');
        const xml = xmlBuffer.toString('utf-8');

        const regexText = new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
        const regexDesc = new RegExp(`content-desc="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
        
        const match = xml.match(regexText) || xml.match(regexDesc);

        if (match) {
            const x = Math.floor((parseInt(match[1]) + parseInt(match[3])) / 2);
            const y = Math.floor((parseInt(match[2]) + parseInt(match[4])) / 2);
            return { x, y };
        }
    } catch (e) {
        console.error(`[Error] UI取得失敗 (${text}):`, e.message);
    }
    return null;
}

/**
 * 画面を末尾方向へスクロール（2回連続）
 */
async function doubleScroll(device) {
    console.log('画面をスクロール中...');
    for (let i = 0; i < 2; i++) {
        await swipe(device, 540, 1600, 540, 400);
        await sleep(CONFIG.WAIT.AFTER_SCROLL);
    }
}

/**
 * 同じタブでURLを開く（URLバー入力方式）
 */
async function goToUrlSameTab(device, url) {
    console.log(`同じタブで遷移: ${url}`);
    
    // アドレスバーにフォーカス
    await tap(device, CONFIG.TAP_COORDS.URL_BAR.x, CONFIG.TAP_COORDS.URL_BAR.y);
    await sleep(1500);

    // 全選択 & 消去
    console.log('既存のURLを消去...');
    await keyEvent(device, 29, 4096); // Ctrl+A
    await sleep(500);
    await keyEvent(device, 67); // Backspace
    await sleep(1000);

    // URL入力
    console.log('URLを入力中...');
    await inputText(device, url);
    await sleep(4000);

    // 実行
    console.log('ページへ移動...');
    await keyEvent(device, 66); // Enter
    await sleep(1000);
    await keyEvent(device, 66); // 念のため2回

    await sleep(CONFIG.WAIT.RETRY_LOAD);
}

/**
 * 1記事の読了処理
 */
async function processOneArticle(device) {
    console.log('読了処理を開始...');
    let retryCount = 0;

    while (retryCount < 30) {
        await doubleScroll(device);
        
        // 1. スタンプGET確認
        const stampBtn = await findElement(device, "スタンプGET");
        if (stampBtn && stampBtn.y > 300) {
            console.log('★スタンプGETボタンをタップ！');
            await tap(device, stampBtn.x, stampBtn.y);
            return true;
        }

        // 2. 続きを読む確認
        const moreBtn = await findElement(device, "続きを読む");
        if (moreBtn && moreBtn.y > 300) {
            console.log('「続きを読む」をタップ。');
            await tap(device, moreBtn.x, moreBtn.y);
            await sleep(CONFIG.WAIT.AFTER_BUTTON_TAP);
        }
        retryCount++;
    }
    return false;
}

/**
 * メインルーチン
 */
async function run() {
    console.log('Androidデバイスを探索中...');
    const [device] = await _android.devices();
    if (!device) {
        console.error('デバイスが接続されていません。');
        return;
    }
    console.log('デバイス接続完了。');

    // 初期化：一覧表示
    console.log('ポイ活を開始します。記事一覧を表示...');
    await device.shell(`am start -a android.intent.action.VIEW -d "${CONFIG.LIST_URL}" ${CONFIG.BRAVE_PKG}`);
    await sleep(CONFIG.WAIT.INITIAL_LOAD);

    for (let i = 1; i <= CONFIG.MAX_ARTICLES; i++) {
        console.log(`\n----- 記事 ${i} / ${CONFIG.MAX_ARTICLES} -----`);

        // 1. 記事を開く（初回のみ一覧から、以降は連結ボタン経由）
        if (i === 1) {
            await tap(device, CONFIG.TAP_COORDS.FIRST_ARTICLE.x, CONFIG.TAP_COORDS.FIRST_ARTICLE.y);
            await sleep(CONFIG.WAIT.ARTICLE_LOAD);
        }

        // 2. 読了・獲得
        const success = await processOneArticle(device);

        // 3. 次の記事へ
        if (success) {
            await sleep(CONFIG.WAIT.STAMP_CARD_LOAD);
            await doubleScroll(device);

            const nextBtn = await findElement(device, "次の記事を読む");
            if (nextBtn) {
                console.log('▶ 次の記事へ進みます');
                await tap(device, nextBtn.x, nextBtn.y);
                await sleep(CONFIG.WAIT.NEXT_ARTICLE_LOAD);
            } else {
                console.log('「次の記事を読む」が見つかりません。全記事読了の可能性があります。');
                break;
            }
        } else {
            console.log('読了に失敗しました。');
            console.log('一覧に戻ってリフレッシュします...');
            await goToUrlSameTab(device, CONFIG.LIST_URL);
            // 記事を開き直す
            await tap(device, CONFIG.TAP_COORDS.FIRST_ARTICLE.x, CONFIG.TAP_COORDS.FIRST_ARTICLE.y);
            await sleep(CONFIG.WAIT.ARTICLE_LOAD);
        }
    }

    console.log('\n===== すべての工程が終了しました =====');
    process.exit(0);
}

run();
