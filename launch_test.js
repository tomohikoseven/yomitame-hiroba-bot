const { _android } = require('playwright');

async function launchBrowser() {
    console.log('Androidデバイスを探しています...');
    const [device] = await _android.devices();

    if (!device) {
        console.error('デバイスが見つかりませんでした。');
        return;
    }

    console.log(`接続完了: ${device.model()}`);

    // 回避策：一度Chromeを完全に終了
    await device.shell('am force-stop com.android.chrome');
    await new Promise(r => setTimeout(r, 1000));

    // 回避策：Playwrightの起動を待たずに、先にAndroidのシステム命令でGoogleを開く
    console.log('システム命令でURLを直接送り込みます...');
    await device.shell('am start -a android.intent.action.VIEW -d "https://www.google.com" com.android.chrome');

    console.log('5秒待機してブラウザに接続を試みます...');
    await new Promise(r => setTimeout(r, 5000));

    try {
        // すでに起動しているブラウザを制御対象として取得
        const context = await device.launchBrowser({
            pkg: 'com.android.chrome'
        });

        // 既に開いている（はずの）ページを探す
        let pages = context.pages();
        let page = pages.length > 0 ? pages[0] : await context.newPage();

        console.log('現在のURL:', page.url());

        // もしGoogleが開いていなければ改めて移動
        if (!page.url().includes('google')) {
            await page.goto('https://www.google.com', { timeout: 30000 });
        }

        console.log('成功しました！タイトル:', await page.title());
        console.log('スマホの画面でGoogleが表示されていることを確認してください。');

    } catch (e) {
        console.error('エラーが発生しました:', e.message);
        console.log('\n--- 注意 ---');
        console.log('このスマホは基本的にADBによる操作しかできないでしょう');
    }
}

launchBrowser();
