import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";

function trackNumber(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/);
  const number = match ? Number(match[1]) : null;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readTags(file) {
  return new Promise(resolve => {
    jsmediatags.read(file, {
      onSuccess: ({ tags }) => resolve({ title: typeof tags.title === "string" ? tags.title.trim() : "", artist: typeof tags.artist === "string" ? tags.artist.trim() : "", album: typeof tags.album === "string" ? tags.album.trim() : "", trackNumber: trackNumber(tags.track) }),
      onError: () => resolve(null)
    });
  });
}

function readDuration(file) {
  return new Promise(resolve => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const finish = duration => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const timer = setTimeout(() => finish(null), 15000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

export async function readMetadata(file) {
  const [tags, duration] = await Promise.all([readTags(file), readDuration(file)]);
  const issues = [];
  if (!tags) issues.push("metadata");
  if (duration === null) issues.push("duration");
  return { title: tags?.title || "", artist: tags?.artist || "", album: tags?.album || "", trackNumber: tags?.trackNumber ?? null, duration, issues };
}
