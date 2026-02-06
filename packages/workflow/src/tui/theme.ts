// ─── Colors ──────────────────────────────────────────────────────────────────

export const theme = {
	primary: "\x1b[36m",
	accent: "\x1b[38;5;208m",
	success: "\x1b[32m",
	warning: "\x1b[33m",
	error: "\x1b[31m",
	muted: "\x1b[90m",
	reset: "\x1b[0m",
};

// ─── Node State Icons ────────────────────────────────────────────────────────

export const icons = {
	pending: `${theme.muted}○${theme.reset}`,
	active: `${theme.accent}●${theme.reset}`,
	complete: `${theme.success}◆${theme.reset}`,
	error: `${theme.error}✖${theme.reset}`,
	loop: `${theme.primary}⟳${theme.reset}`,
	loopActive: `${theme.accent}⟳${theme.reset}`,
	loopComplete: `${theme.success}⟳${theme.reset}`,
	ifTrue: `${theme.success}◈${theme.reset}`,
	ifFalse: `${theme.muted}◇${theme.reset}`,
	input: `${theme.accent}?${theme.reset}`,
	inputComplete: `${theme.success}◆${theme.reset}`,
};

// ─── Node Type Labels ────────────────────────────────────────────────────────

export const nodeLabels: Record<string, string> = {
	generation: `${theme.primary}Generation${theme.reset}`,
	structured: `${theme.primary}Structured${theme.reset}`,
	websearch: `${theme.primary}WebSearch${theme.reset}`,
	webfetch: `${theme.primary}WebFetch${theme.reset}`,
	loop: `${theme.primary}Loop${theme.reset}`,
	if: `${theme.primary}If${theme.reset}`,
	set: `${theme.primary}Set${theme.reset}`,
	log: `${theme.primary}Log${theme.reset}`,
	flow: `${theme.primary}Flow${theme.reset}`,
	prompt: `${theme.primary}Prompt${theme.reset}`,
	select: `${theme.primary}Select${theme.reset}`,
	confirm: `${theme.primary}Confirm${theme.reset}`,
};

// ─── Markdown Theme ──────────────────────────────────────────────────────────

export const markdownTheme = {
	text: (t: string) => t,
	bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
	italic: (t: string) => `\x1b[3m${t}\x1b[23m`,
	strikethrough: (t: string) => `\x1b[9m${t}\x1b[29m`,
	underline: (t: string) => `\x1b[4m${t}\x1b[24m`,
	heading: (t: string) => `\x1b[1m${t}\x1b[22m`,
	code: (t: string) => `${theme.accent}${t}${theme.reset}`,
	codeBlock: (t: string) => `\x1b[90m${t}\x1b[0m`,
	codeBlockBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
	link: (t: string) => `\x1b[34m${t}\x1b[0m`,
	linkUrl: (t: string) => `\x1b[90m${t}\x1b[0m`,
	list: (t: string) => t,
	listBullet: (t: string) => `${theme.accent}${t}${theme.reset}`,
	quote: (t: string) => `\x1b[90m${t}\x1b[0m`,
	quoteBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
	hr: (t: string) => `\x1b[90m${t}\x1b[0m`,
	tableBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
};
