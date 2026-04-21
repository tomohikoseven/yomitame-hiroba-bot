const { execSync } = require('child_process');

/**
 * 1. Configuration (Immutable Data)
 * 定数や設定値は、プログラムの他の部分から切り離して管理します。
 */
const CONFIG = {
    BRAVE_PKG: 'com.brave.browser',
    LIST_URL: 'https://hiroba-sp.yomu-point.jp/magazineList/',
    MAX_ARTICLES: 150,
    COORDS: {
        SECOND_ARTICLE: { x: 540, y: 1800 },
        CONTINUE_READING: { x: 540, y: 2000 },
        NEXT_ARTICLE: { x: 792, y: 1232 }
    },
    TIMEOUTS: {
        INITIAL_LOAD: 12000,
        ARTICLE_LOAD: 2000,
        STAMP_CARD_LOAD: 1000,
        NEXT_ARTICLE_LOAD: 2000,
        ACTION_WAIT: 300,
        UI_STABILIZE: 500
    }
};

/**
 * 2. ADB Client (Infrastructure Layer)
 * ADBコマンドを実行するための低レベルなクラスです。
 * 「外部システム（OS、コマンドライン）との通信」という責務を負います。
 */
class AdbClient {
    execute(command, options = {}) {
        try {
            return execSync(`adb shell ${command}`, {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 1024 * 1024 * 5,
                ...options
            });
        } catch (e) {
            return e.stdout ? e.stdout.toString() : "";
        }
    }

    checkConnection() {
        try {
            execSync('adb devices');
        } catch (e) {
            throw new Error('ADBが利用できません。デバイスの接続を確認してください。');
        }
    }
}

/**
 * 3. Device Controller (Hardware Abstraction Layer)
 * ADB Clientを使い、Androidデバイスに対する「操作」を抽象化します。
 * xml解析などのロジックもここにカプセル化し、呼び出し側が「ADBのコマンド」を意識しなくて済むようにします。
 */
class AndroidDevice {
    constructor(client) {
        this.client = client;
    }

    tap(x, y) {
        this.client.execute(`input tap ${x} ${y}`);
    }

    swipe(x1, y1, x2, y2, duration = 500) {
        this.client.execute(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
    }

    scrollDown() {
        // スクロールの「方法」をこのメソッドに隠蔽します
        for (let i = 0; i < 2; i++) {
            this.swipe(540, 1600, 540, 400);
        }
    }

    openUrl(url, packageName) {
        this.client.execute(`am start -a android.intent.action.VIEW -d "${url}" ${packageName}`);
    }

    /**
     * 画面のUI構造(XML)を取得し、特定のテキストを持つ要素の座標を返します。
     */
    async findCoordinates(text) {
        const xml = this.client.execute('-t -t uiautomator dump /dev/tty');
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

/**
 * 4. Yomitame Bot (Application/Service Layer)
 * 「ヨミタメ広場を自動で読む」というビジネスロジックをカプセル化します。
 * デバイスが「どう動くか」ではなく、アプリケーションとして「何を達成するか」に焦点を当てます。
 */
class YomitameBot {
    constructor(device) {
        this.device = device;
    }

    async start() {
        console.log('===== オブジェクト指向版 自動読了システム =====');
        this.device.openUrl(CONFIG.LIST_URL, CONFIG.BRAVE_PKG);
        await this._sleep(CONFIG.TIMEOUTS.INITIAL_LOAD);

        // 記事を開く
        await this.openSecondArticle();

        for (let i = 1; i <= CONFIG.MAX_ARTICLES; i++) {
            console.log(`\n[Article ${i}/${CONFIG.MAX_ARTICLES}]`);

            const success = await this.completeArticle();
            if (!success) {
                console.error('記事の読了に失敗しました。中断します。');
                break;
            }

            const moved = await this.moveToNextArticle();
            if (!moved) {
                console.log('次の記事が見つかりません。完了しました。');
                break;
            }
        }
    }

    async openSecondArticle() {
        console.log('2番目の記事を開いています...');
        const { x, y } = CONFIG.COORDS.SECOND_ARTICLE;
        this.device.tap(x, y);
        await this._sleep(CONFIG.TIMEOUTS.ARTICLE_LOAD);
    }

    async completeArticle() {
        console.log('記事を読んでいます...');
        for (let retry = 0; retry < 10; retry++) {
            console.log(`スクロール中...(${retry + 1}回目)`);
            this.device.scrollDown();
            await this._sleep(CONFIG.TIMEOUTS.ACTION_WAIT);

            // 動作調整用
            // console.log出力の座標で，CONFIG.COORDS.CONTINUE_READING.xと.yを調整する．
            // xは画面の左上を原点として右方向の座標，yは左上を原点として下方向の座標．
            // xは特定の座標になるはず，yは出力座標の平均値を指定すればよいと思う． 
            // const continueBtn = await this.device.findCoordinates("続きを読む");
            // console.log(continueBtn.x, continueBtn.y);

            // 「続きを読む」もしくは「スタンプGET」ボタンをタップ 
            this.device.tap(CONFIG.COORDS.CONTINUE_READING.x, CONFIG.COORDS.CONTINUE_READING.y);
            await this._sleep(CONFIG.TIMEOUTS.ACTION_WAIT);

        }
        return true;
    }

    async moveToNextArticle() {
        await this._sleep(CONFIG.TIMEOUTS.STAMP_CARD_LOAD);

        const nextBtn = await this.device.findCoordinates("次の記事を読む");
        if (nextBtn) {

            // 動作調整用
            // console.log出力の座標で，CONFIG.COORDS.NEXT_ARTICLE.xと.yを調整する．
            // xは画面の左上を原点として右方向の座標，yは左上を原点として下方向の座標．
            // xとyは特定の座標になるはず． 
            // console.log(nextBtn.x, nextBtn.y);

            console.log('▶ 次の記事へ進みます');
            this.device.tap(CONFIG.COORDS.NEXT_ARTICLE.x, CONFIG.COORDS.NEXT_ARTICLE.y);
            await this._sleep(CONFIG.TIMEOUTS.NEXT_ARTICLE_LOAD);
            return true;
        }
        return false;
    }

    async _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

}

/**
 * 5. Execution (Entry Point)
 * 各コンポーネントをインスタンス化し、依存性を注入（DI）して実行します。
 */
async function main() {
    try {
        const client = new AdbClient();
        client.checkConnection();

        const device = new AndroidDevice(client);
        const bot = new YomitameBot(device);

        await bot.start();

        console.log('\nすべての処理を正常に終了しました。');
    } catch (e) {
        console.error('\n[Error]', e.message);
        process.exit(1);
    }
}

main();
