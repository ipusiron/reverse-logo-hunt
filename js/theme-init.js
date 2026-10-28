/**
 * theme-init - 最初の描画の前にテーマを決める。<head> で同期読み込みする（ES module ではない）。
 *
 * style.css の既定はダークで、ライトは <html> の data-theme="light" で切り替える。
 * この判定を js/main.js（type="module" なので解析のあとに動く）で行うと、
 * ダークで描いたあとにライトへ切り替わって見える（ライトを保存した人だけに起きる）。
 *
 * 保存した選択（localStorage の theme が "light"）ならライト、それ以外はダーク。
 * OS の設定には従わない。localStorage が使えない環境でも落ちないよう try/catch で囲む。
 */
(function (global) {
  "use strict";

  let saved = null;
  try {
    saved = global.localStorage.getItem("theme");
  } catch {
    // 使えない環境でもダークで続ける
  }

  global.document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");
})(typeof window !== "undefined" ? window : globalThis);
