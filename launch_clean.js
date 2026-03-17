const { execSync } = require('child_process');

/* =========================================================
 * 1. Entities / Domain Layer (中心のルール・設定層)
 * アプリケーションの最も核となる設定値や静的なルールを定義します。
 * ここには外部システム（ADBなど）の知識は一切入りません。
 * ========================================================= */
const CONFIG = {
    BRAVE_PKG: 'com.brave.browser',
    LIST_URL: 'https://hiroba-sp.yomu-point.jp/magazineList/',
    MAX_ARTICLES: 150,
    TAP_COORDS: {
        FIRST_ARTICLE: { x: 540, y: 1800 }
    },
    WAIT: {
        INITIAL_LOAD: 5000,
        ARTICLE_LOAD: 2000,
        STAMP_CARD_LOAD: 1000,
        NEXT_ARTICLE_LOAD: 1000,
        RETRY_LOAD: 2000,
        AFTER_SCROLL: 500,
        AFTER_BUTTON_TAP: 500
    }
};


/* =========================================================
 * 2. Frameworks & Drivers Layer (インフラ層)
 * 最も外側の世界。OSや外部機器（今回はADB）と通信するだけの「泥臭い」処理を担当します。
 * ========================================================= */
class AdbDriver {
    checkConnection() {
        execSync('adb devices');
    }

    shell(command, usePty = false) {
        try {
            const ptyFlags = usePty ? '-t -t ' : '';
            return execSync(`adb shell ${ptyFlags}${command}`, {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 1024 * 1024 * 5
            });
        } catch (e) {
            // 例外が発生しても、標準出力にデータが残っている場合はそれを返す
            return e.stdout ? e.stdout.toString() : "";
        }
    }
}


/* =========================================================
 * 3. Interface Adapters Layer (インターフェースアダプター層)
 * インフラ（生データ）とユースケース（シナリオ）の橋渡し役。
 * バイト列やXMLをパースして、「操作可能なインターフェース」に変換します。
 * ========================================================= */
class ScreenParser {
    static getCoords(xml, text) {
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
}

class AndroidDeviceController {
    constructor(driver) {
        this.driver = driver;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    tap(x, y) {
        this.driver.shell(`input tap ${x} ${y}`);
    }

    swipe(x1, y1, x2, y2, duration = 500) {
        this.driver.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
    }

    openApp(url, pkg) {
        this.driver.shell(`am start -a android.intent.action.VIEW -d "${url}" ${pkg}`);
    }

    getScreenXml() {
        return this.driver.shell('uiautomator dump /dev/tty', true);
    }
}


/* =========================================================
 * 4. Use Cases Layer (ユースケース層 / アプリケーション進行シナリオ)
 * 「ヨミタメ広場でポイ活をする」という業務フローそのものを定義します。
 * ここでは「ADB」や「XML」という言葉は使わず、DeviceControllerという「抽象的な概念」に指示を出すだけです。
 * ========================================================= */
class YomitameAutoReaderUseCase {
    constructor(device, config) {
        this.device = device;
        this.config = config;
    }

    async execute() {
        console.log('===== クリーンアーキテクチャ版 自動読了スクリプト =====');
        
        console.log('記事一覧を表示...');
        this.device.openApp(this.config.LIST_URL, this.config.BRAVE_PKG);
        await this.device.sleep(this.config.WAIT.INITIAL_LOAD);

        for (let i = 1; i <= this.config.MAX_ARTICLES; i++) {
            console.log(`\n----- 記事 ${i} / ${this.config.MAX_ARTICLES} -----`);

            if (i === 1) {
                console.log('最初の記事をタップ...');
                this.device.tap(this.config.TAP_COORDS.FIRST_ARTICLE.x, this.config.TAP_COORDS.FIRST_ARTICLE.y);
                await this.device.sleep(this.config.WAIT.ARTICLE_LOAD);
            }

            const success = await this._readOneArticle();

            if (success) {
                const hasNext = await this._goToNextArticle();
                if (!hasNext) {
                    console.log('「次の記事を読む」が見つかりません。終了します。');
                    break;
                }
            } else {
                console.log('読了に失敗しました。中断します。');
                break;
            }
        }
        console.log('\n===== すべての工程が終了しました =====');
    }

    // 内部ユースケース：1記事を読む
    async _readOneArticle() {
        console.log('読了処理を開始...');
        let retryCount = 0;

        while (retryCount < 20) {
            await this._scrollDown();
            await this.device.sleep(1000); // 画面安定待ち

            // アダプター層（ScreenParser）の機能を借りて、現在の画面からボタンを探す
            const xml = this.device.getScreenXml();
            const stampBtn = ScreenParser.getCoords(xml, "スタンプGET");
            const moreBtn = ScreenParser.getCoords(xml, "続きを読む");

            if (stampBtn && stampBtn.y > 300) {
                console.log('★スタンプGETボタンをタップ！');
                this.device.tap(stampBtn.x, stampBtn.y);
                return true; // 読了成功
            }

            if (moreBtn && moreBtn.y > 300) {
                console.log('「続きを読む」をタップ。');
                this.device.tap(moreBtn.x, moreBtn.y);
                await this.device.sleep(this.config.WAIT.AFTER_BUTTON_TAP);
            } else {
                console.log('ボタンが見つかりません。さらにスクロールします。');
            }
            retryCount++;
        }
        return false; // タイムアウト
    }

    // 内部ユースケース：次の記事へ遷移する
    async _goToNextArticle() {
        await this.device.sleep(this.config.WAIT.STAMP_CARD_LOAD);
        await this._scrollDown();
        await this.device.sleep(1000);

        const xml = this.device.getScreenXml();
        const nextBtn = ScreenParser.getCoords(xml, "次の記事を読む");

        if (nextBtn) {
            console.log('▶ 次の記事へ進みます');
            this.device.tap(nextBtn.x, nextBtn.y);
            await this.device.sleep(this.config.WAIT.NEXT_ARTICLE_LOAD);
            return true;
        }
        return false;
    }

    // 内部ユースケース：記事をスクロールする表現
    async _scrollDown() {
        console.log('画面をスクロール中...');
        for (let i = 0; i < 2; i++) {
            this.device.swipe(540, 1600, 540, 400);
        }
        await this.device.sleep(this.config.WAIT.AFTER_SCROLL);
    }
}


/* =========================================================
 * Main (Dependency Injection / 組立と実行)
 * ここで初めて、各層のパーツをパズルのように組み立てて実行します。
 * ========================================================= */
async function main() {
    try {
        // 1. ドライバ（インフラ）の生成
        const adbDriver = new AdbDriver();
        adbDriver.checkConnection(); // 接続チェック

        // 2. アダプター（コントローラー）の生成
        const deviceController = new AndroidDeviceController(adbDriver);

        // 3. ユースケース（シナリオ）の生成し、コントローラーを注入（依存性の注入）
        const useCase = new YomitameAutoReaderUseCase(deviceController, CONFIG);

        // 4. 実行！
        await useCase.execute();

    } catch (e) {
        console.error('致命的なエラーが発生しました:', e.message);
        process.exit(1);
    }
}

// スクリプト起動
main();
