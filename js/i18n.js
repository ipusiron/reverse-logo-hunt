// 画面の言語の切り替え（DOM）。辞書と言語の選び方は messages.js
import { t, setLang, getLang, chooseLang, LANGS } from "./messages.js";
import { getItem, setItem } from "./storage.js";

// 最初の言語を決める: ?lang= → 保存した選択 → ブラウザーの言語
export function initLang() {
  const param = new URLSearchParams(window.location.search).get("lang");
  setLang(chooseLang({ param, stored: getItem("lang"), browser: navigator.language }));
  return getLang();
}

// data-i18n の要素の文字と、data-i18n-attr（"属性:キー;属性:キー"）の属性を、今の言語の辞書から入れる
export function applyStatic(root = document) {
  document.documentElement.lang = getLang();
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

// 言語を切り替えて保存する。URL に ?lang= があれば外す（読み込み直したときに保存した選択を使うため）
export function switchLang(next) {
  const lang = LANGS.includes(next) ? next : getLang() === "ja" ? "en" : "ja";
  setLang(lang);
  setItem("lang", lang);
  const url = new URL(window.location.href);
  if (url.searchParams.has("lang")) {
    url.searchParams.delete("lang");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  applyStatic();
  return lang;
}
