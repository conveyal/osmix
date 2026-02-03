/* Generate by @shikijs/codegen */

import {
	createBundledHighlighter,
	createSingletonShorthands,
} from "@shikijs/core"
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript"
import type {
	DynamicImportLanguageRegistration,
	DynamicImportThemeRegistration,
	HighlighterGeneric,
} from "@shikijs/types"

type BundledLanguage =
	| "typescript"
	| "ts"
	| "cts"
	| "mts"
	| "shellscript"
	| "bash"
	| "sh"
	| "shell"
	| "zsh"
type BundledTheme = "github-light"
type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const bundledLanguages = {
	typescript: () => import("@shikijs/langs/typescript"),
	ts: () => import("@shikijs/langs/typescript"),
	cts: () => import("@shikijs/langs/typescript"),
	mts: () => import("@shikijs/langs/typescript"),
	shellscript: () => import("@shikijs/langs/shellscript"),
	bash: () => import("@shikijs/langs/shellscript"),
	sh: () => import("@shikijs/langs/shellscript"),
	shell: () => import("@shikijs/langs/shellscript"),
	zsh: () => import("@shikijs/langs/shellscript"),
} as Record<BundledLanguage, DynamicImportLanguageRegistration>

const bundledThemes = {
	"github-light": () => import("@shikijs/themes/github-light"),
} as Record<BundledTheme, DynamicImportThemeRegistration>

const createHighlighter = /* @__PURE__ */ createBundledHighlighter<
	BundledLanguage,
	BundledTheme
>({
	langs: bundledLanguages,
	themes: bundledThemes,
	engine: () => createJavaScriptRegexEngine(),
})

const {
	codeToHtml,
	codeToTokensBase,
	codeToTokens,
	codeToTokensWithThemes,
	getSingletonHighlighter,
} = /* @__PURE__ */ createSingletonShorthands<BundledLanguage, BundledTheme>(
	createHighlighter,
)

export {
	bundledLanguages,
	bundledThemes,
	codeToHtml,
	codeToTokens,
	codeToTokensBase,
	codeToTokensWithThemes,
	createHighlighter,
	getSingletonHighlighter,
}
export type { BundledLanguage, BundledTheme, Highlighter }
