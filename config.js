/**
 * 1. Configuration (Immutable Data)
 * 定数や設定値は、プログラムの他の部分から切り離して管理します。
 */
module.exports = {
    BRAVE_PKG: 'com.brave.browser',
    LIST_URL: 'https://hiroba-sp.yomu-point.jp/magazineList/',
    MAX_ARTICLES: 150,
    COORDS: {
        FIRST_ARTICLE: { x: 540, y: 1500 },
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
