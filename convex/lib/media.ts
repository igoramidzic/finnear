const IMAGE_EXTENSIONS = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"heic",
	"heif",
]);

const AUDIO_EXTENSIONS = new Set([
	"wav",
	"mp3",
	"aiff",
	"aac",
	"ogg",
	"flac",
	"m4a",
	"caf",
]);

export type MediaKind = "image" | "audio" | "unknown";

export function classifyMediaUrlByExtension(url: string): MediaKind {
	const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
	const ext = match?.[1].toLowerCase();
	if (!ext) return "unknown";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (AUDIO_EXTENSIONS.has(ext)) return "audio";
	return "unknown";
}
