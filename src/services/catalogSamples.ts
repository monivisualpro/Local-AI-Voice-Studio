import { ReferenceAudioItem } from '../types/tts';
import {
  SAMPLE_CATEGORIES,
  SampleSeedTuple,
} from './catalogSampleSeeds';
import { SAMPLE_AUDIO_POOL, getClipGender, getClipLanguage } from './catalogSamplePool';

/**
 * Deterministic builder for the generated sample catalog.
 * Combines the hand-authored seeds with the verified remote stem pool so every
 * generated entry has a real downloadUrl (download-later workflow) while its
 * url stays empty until the user downloads it.
 */
const DOWNLOAD_BASE_URL =
  'https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/';

/** Fixed timestamp keeps ids/createdAt stable across reloads and machines. */
const SAMPLE_CREATED_AT = 1704067200000;

/** ~9 kB per second matches the average bitrate of the reference stems. */
const AVERAGE_BYTES_PER_SECOND = 9000;

function buildEntry(
  categoryKey: string,
  folderId: string,
  folderName: string,
  defaultLanguage: string,
  baseTag: string,
  seed: SampleSeedTuple,
  seedIndex: number,
  poolEntry: [string, number],
): ReferenceAudioItem {
  const [name, accent, gender, timbre, languageOverride] = seed;
  const language = languageOverride || defaultLanguage;
  const [repoPath, size] = poolEntry;
  const clipLanguage = getClipLanguage(repoPath);

  return {
    id: `ref-sample-${categoryKey}-${seedIndex + 1}`,
    name,
    language,
    accent,
    folderId,
    folderName,
    size,
    duration: Math.max(1, Math.round((size / AVERAGE_BYTES_PER_SECOND) * 10) / 10),
    url: '',
    downloadUrl: `${DOWNLOAD_BASE_URL}${repoPath}`,
    isDownloaded: false,
    // The words spoken in the shared sample clips are not known, so no transcript is
    // claimed. (A wrong transcript would degrade cloning; engines that need one - e.g.
    // F5-TTS - ask the user to type it.)
    referenceText: undefined,
    speakerGender: gender,
    timbreDescription:
      clipLanguage !== language
        ? `${timbre} (Timbre reference: the sample clip is an ${clipLanguage} recording.)`
        : timbre,
    tags: clipLanguage !== language ? [baseTag, language, accent, `${clipLanguage} clip`] : [baseTag, language, accent],
    createdAt: SAMPLE_CREATED_AT,
    isBuiltIn: true,
  };
}

/**
 * Picks the pool clip for an entry. A male-labelled entry only ever gets a clip of a
 * known male speaker, a female-labelled entry only a known female speaker, so the
 * gender shown in the UI always matches what is heard. Round-robin runs inside each
 * gender group. Neutral / character voices may use any clip.
 */
function buildPools() {
  const female = SAMPLE_AUDIO_POOL.filter(([p]) => getClipGender(p) === 'female');
  const male = SAMPLE_AUDIO_POOL.filter(([p]) => getClipGender(p) === 'male');
  return { female, male, any: SAMPLE_AUDIO_POOL };
}

function buildSampleReferenceAudios(): ReferenceAudioItem[] {
  const items: ReferenceAudioItem[] = [];
  const pools = buildPools();
  const cursor = { female: 0, male: 0, neutral: 0 };

  for (const category of SAMPLE_CATEGORIES) {
    category.seeds.forEach((seed, seedIndex) => {
      const gender = seed[2];
      const pool = gender === 'female' ? pools.female : gender === 'male' ? pools.male : pools.any;
      const poolEntry = pool[cursor[gender] % pool.length];
      cursor[gender] += 1;
      items.push(
        buildEntry(
          category.key,
          category.folderId,
          category.folderName,
          category.defaultLanguage,
          category.baseTag,
          seed,
          seedIndex,
          poolEntry,
        ),
      );
    });
  }

  return items;
}

/**
 * 350 generated samples: 50 Celebrity/Iconic + 50 Asian + 50 Hindi + 50 English
 * + 50 Arabic + 50 European + 50 Animated. Merged after the 20 curated stems
 * by INITIAL_REFERENCE_AUDIOS in catalogAudios.ts.
 */
export const SAMPLE_REFERENCE_AUDIOS: ReferenceAudioItem[] = buildSampleReferenceAudios();
