const { execSync } = require('child_process');

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
        INITIAL_LOAD: 8000,        // 初回ロード: 5秒
        ARTICLE_LOAD: 2000,        // 記事ロード: 2秒
        STAMP_CARD_LOAD: 2000,     // スタンプページロード: 1秒
        NEXT_ARTICLE_LOAD: 2000,   // 次の記事のロード: 1秒
        RETRY_LOAD: 2000,          // エラー時のやり直し: 2秒
        AFTER_SCROLL: 800,         // スクロール後: 0.5秒
        AFTER_BUTTON_TAP: 800      // 続きを読むタップ後: 0.5秒
    }
};

/**
 * ADB ユーティリティ
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function adbShell(command) {
    try {
        // 出力サイズが大きいため、maxBufferを拡張
        return execSync(`adb shell "${command}"`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 1024 * 1024 * 2
        });
    } catch (e) {
        if (command.includes('uiautomator dump')) {
            return e.stdout ? e.stdout.toString() : "";
        }
        return "";
    }
}

function tap(x, y) {
    return adbShell(`input tap ${x} ${y}`);
}

function swipe(x1, y1, x2, y2, duration = 500) {
    return adbShell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
}

/**
 * 画面上の要素の座標を取得する
 */
function getCoords(xml, text) {
    if (!xml) return null;
    const regexText = new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
    const regexDesc = new RegExp(`content-desc="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);

    const match = xml.match(regexText) || xml.match(regexDesc);
    if (match) {
        return {
            x: Math.floor((parseInt(match[1]) + parseInt(match[3])) / 2),
            y: Math.floor((parseInt(match[2]) + parseInt(match[4])) / 2)
        };
    }
    return null;
}

/**
 * 画面のXMLを直接取得する（ADB専用処理）
 */
function dumpXml() {
    try {
        // execSyncはターミナルではないため、-t -t を付けて強制的に疑似ターミナルを割り当てる
        return execSync('adb shell -t -t uiautomator dump /dev/tty', {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 1024 * 1024 * 5
        });
    } catch (e) {
        return e.stdout ? e.stdout.toString() : "";
    }
}

/**
 * 2回連続でスクロールを行う
 */
async function doubleScroll() {
    console.log('画面をスクロール中...');
    for (let i = 0; i < 2; i++) {
        await swipe(540, 1600, 540, 400);
    }
    await sleep(CONFIG.WAIT.AFTER_SCROLL);
}

/**
 * 1記事の読了処理
 */
async function processOneArticle() {
    console.log('読了処理を開始...');
    let retryCount = 0;

    while (retryCount < 20) {
        await doubleScroll();
        await sleep(1000); // UIの安定待ち

        // 1回のダンプで両方のボタンを探す（効率化）
        const xml = dumpXml();

        // スタンプGET確認
        const stampBtn = getCoords(xml, "スタンプGET");
        if (stampBtn && stampBtn.y > 300) {
            console.log('★スタンプGETボタンをタップ！');
            await tap(stampBtn.x, stampBtn.y);
            return true;
        }

        // 続きを読む確認
        const moreBtn = getCoords(xml, "続きを読む");
        if (moreBtn && moreBtn.y > 300) {
            console.log('「続きを読む」をタップ。');
            await tap(moreBtn.x, moreBtn.y);
            await sleep(CONFIG.WAIT.AFTER_BUTTON_TAP);
        } else {
            console.log('ボタンが見つかりません。さらにスクロールします。');
        }
        retryCount++;
    }
    return false;
}

/**
 * メインルーチン
 */
async function run() {
    console.log('===== 純粋ADB版 自動読了スクリプト (安定化版) =====');

    try {
        execSync('adb devices');
    } catch (e) {
        console.error('エラー: ADBが利用できません。');
        process.exit(1);
    }

    console.log('記事一覧を表示...');
    adbShell(`am start -a android.intent.action.VIEW -d "${CONFIG.LIST_URL}" ${CONFIG.BRAVE_PKG}`);
    await sleep(CONFIG.WAIT.INITIAL_LOAD);

    for (let i = 1; i <= CONFIG.MAX_ARTICLES; i++) {
        console.log(`\n----- 記事 ${i} / ${CONFIG.MAX_ARTICLES} -----`);

        if (i === 1) {
            console.log('最初の記事をタップ...');
            await tap(CONFIG.TAP_COORDS.FIRST_ARTICLE.x, CONFIG.TAP_COORDS.FIRST_ARTICLE.y);
            await sleep(CONFIG.WAIT.ARTICLE_LOAD);
        }

        const success = await processOneArticle();

        if (success) {
            await sleep(CONFIG.WAIT.STAMP_CARD_LOAD);
            await swipe(540, 1600, 540, 400);
            await sleep(CONFIG.WAIT.AFTER_SCROLL);

            const xml = dumpXml();
            const nextBtn = getCoords(xml, "次の記事を読む");

            if (nextBtn) {
                console.log('▶ 次の記事へ進みます');
                await tap(nextBtn.x, nextBtn.y);
                await sleep(CONFIG.WAIT.NEXT_ARTICLE_LOAD);
            } else {
                console.log('「次の記事を読む」が見つかりません。終了します。');
                break;
            }
        } else {
            console.log('読了に失敗しました。中断します。');
            break;
        }
    }

    console.log('\n===== すべての工程が終了しました =====');
    process.exit(0);
}

run();
