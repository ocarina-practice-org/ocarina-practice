/* 陶笛回家練習｜Firebase 專案設定（firebase-config.js）
   換成你「新建的 Firebase 專案」的設定：Firebase 控制台 → 專案設定（齒輪）→ 一般 → 你的應用程式 → Web 應用程式 → SDK 設定。
   apiKey 本來就會出現在網頁裡，不是機密；真正的保護靠 Firestore 安全規則（見 firestore.rules）。
   ⚠️ 只改這個檔；下面的「貼上…」要全部換掉。 */
window.OP_FIREBASE = {
  config: {
    apiKey: "AIzaSyDx94ocpdHTjtvC2sc_X7t0oTSvzm8GzLg",
    authDomain: "ocarina-practice-1c298.firebaseapp.com",
    projectId: "ocarina-practice-1c298",
    storageBucket: "ocarina-practice-1c298.firebasestorage.app",
    messagingSenderId: "882240863007",
    appId: "1:882240863007:web:a49dddd51f0afda97bce2a"
  },
  sdkVersion: "13.3.0",
  adminEmail: "a0929870116@gmail.com"   /* 後台只有這個帳號能進（要先在 Authentication 建立這個 Email／密碼的使用者）；
                                           firestore.rules 裡的管理者 email 要和這裡一樣 */
};
