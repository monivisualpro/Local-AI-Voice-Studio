import { ReferenceAudioItem } from "../types/tts";
import { SAMPLE_REFERENCE_AUDIOS } from "./catalogSamples";

/**
 * Curated Catalog of 20 High-Fidelity Reference Audio Samples
 * Pre-configured for zero-shot voice cloning across Celebrities, Accents, and Languages.
 * Audio stems are downloaded on-demand and persisted to IndexedDB.
 *
 * INITIAL_REFERENCE_AUDIOS below appends the 350 generated samples
 * (see catalogSamples.ts) after these curated entries.
 */
const CURATED_REFERENCE_AUDIOS: ReferenceAudioItem[] = [
  {
    "id": "ref-lj-lisa",
    "name": "LJ Speech (Lisa)",
    "language": "English",
    "accent": "US Neutral Studio",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 34746,
    "duration": 3.8,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/finetuned/lj/1.mp3",
    "isDownloaded": false,
    "referenceText": "Printing, in the only sense with which we are at present concerned, differs from most if not from all the arts.",
    "speakerGender": "female",
    "timbreDescription": "Gold standard audiobook dataset voice; pristine acoustic clarity, neutral pacing, zero noise.",
    "tags": [
      "Audiobook",
      "Studio Quality",
      "Neutral",
      "Benchmark"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-atkins-omicron",
    "name": "Christopher Atkins",
    "language": "English",
    "accent": "US Articulate",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 38717,
    "duration": 4.2,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/favorites/atkins_omicron.mp3",
    "isDownloaded": false,
    "referenceText": "The molecular configuration of the sample revealed unusual crystalline bonding.",
    "speakerGender": "male",
    "timbreDescription": "Crisp, articulate documentary vocalization with even acoustic projection.",
    "tags": [
      "Documentary",
      "Articulate",
      "American",
      "Clean"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-kennard-road",
    "name": "David Kennard",
    "language": "English",
    "accent": "British Received Pacing",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 27847,
    "duration": 3,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/favorites/kennard_road_not_taken.mp3",
    "isDownloaded": false,
    "referenceText": "Two roads diverged in a yellow wood, and sorry I could not travel both.",
    "speakerGender": "male",
    "timbreDescription": "Gentle, thoughtful British narration with poetic sensitivity and calm baritone tone.",
    "tags": [
      "Poetic",
      "British",
      "Thoughtful",
      "Narrator"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-dotrice-death",
    "name": "Roy Dotrice",
    "language": "English",
    "accent": "Classic British Storyteller",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 24294,
    "duration": 2.6,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/favorites/dotrice_stop_for_death.mp3",
    "isDownloaded": false,
    "referenceText": "Because I could not stop for Death, He kindly stopped for me.",
    "speakerGender": "male",
    "timbreDescription": "Legendary audiobook narrator voice; seasoned, rich grandfatherly storytelling timbre.",
    "tags": [
      "Audiobook Legend",
      "British",
      "Storyteller",
      "Seasoned"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-tim-reynolds",
    "name": "Tim Reynolds",
    "language": "English",
    "accent": "US Dynamic Storyteller",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 47444,
    "duration": 2.5,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/tim_reynolds/1.mp3",
    "isDownloaded": false,
    "referenceText": "He stepped forward through the misty courtyard, searching for any sign of life.",
    "speakerGender": "male",
    "timbreDescription": "Vibrant, dynamic storytelling baritone with animated narrative energy.",
    "tags": [
      "Storyteller",
      "Dynamic",
      "Action",
      "Narrative"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-eleanor-vance",
    "name": "Eleanor Vance",
    "language": "English",
    "accent": "US Clear Conversational",
    "folderId": "folder-english-accents",
    "folderName": "English Accents & Dialects",
    "size": 170158,
    "duration": 5.3,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/mrfakename/E2-F5-TTS/resolve/main/tests/ref_audio/test_en_1_ref_short.wav",
    "isDownloaded": false,
    "referenceText": "Some have accepted it as a miracle, without realizing the fundamental mechanics involved.",
    "speakerGender": "female",
    "timbreDescription": "Official F5-TTS reference voice; pristine conversational clarity and neutral accent.",
    "tags": [
      "F5-TTS Benchmark",
      "Clean",
      "Conversational",
      "Reference"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-de-klaus",
    "name": "Klaus Weber",
    "language": "German",
    "accent": "Standard German (Hochdeutsch)",
    "folderId": "folder-european-languages",
    "folderName": "European Accents & Languages",
    "size": 24712,
    "duration": 2.6,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/deutsch/de_speaker_2.mp3",
    "isDownloaded": false,
    "referenceText": "Guten Tag, wie kann ich Ihnen heute behilflich sein?",
    "speakerGender": "male",
    "timbreDescription": "Clear Standard German male voice with balanced cadence and precise enunciation.",
    "tags": [
      "German",
      "Hochdeutsch",
      "Professional",
      "Clear"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-de-hannah",
    "name": "Hannah Schmidt",
    "language": "German",
    "accent": "Standard German (Hochdeutsch)",
    "folderId": "folder-european-languages",
    "folderName": "European Accents & Languages",
    "size": 31820,
    "duration": 3.4,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/deutsch/de_speaker_3.mp3",
    "isDownloaded": false,
    "referenceText": "Wir freuen uns, Sie bei unserem neuen Projekt begrüßen zu dürfen.",
    "speakerGender": "female",
    "timbreDescription": "Warm, approachable German female timbre with natural modern melodic flow.",
    "tags": [
      "German",
      "Warm",
      "Conversational",
      "Polished"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-de-maximilian",
    "name": "Maximilian Bauer",
    "language": "German",
    "accent": "German Articulate Baritone",
    "folderId": "folder-european-languages",
    "folderName": "European Accents & Languages",
    "size": 29312,
    "duration": 3.1,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/deutsch/de_speaker_4.mp3",
    "isDownloaded": false,
    "referenceText": "Die Entwicklung künstlicher Intelligenz schreitet mit rasender Geschwindigkeit voran.",
    "speakerGender": "male",
    "timbreDescription": "Authoritative, resonant German baritone ideal for documentaries and audiobooks.",
    "tags": [
      "German",
      "Baritone",
      "Documentary",
      "Articulate"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-de-stefan",
    "name": "Stefan Meyer",
    "language": "German",
    "accent": "German Deep Narrative",
    "folderId": "folder-european-languages",
    "folderName": "European Accents & Languages",
    "size": 42688,
    "duration": 4.6,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/deutsch/de_speaker_7.mp3",
    "isDownloaded": false,
    "referenceText": "Es war ein stiller Abend im Spätherbst, als die ersten Blätter zu Boden fielen.",
    "speakerGender": "male",
    "timbreDescription": "Deep, calm German storytelling timbre with rich low-frequency resonance.",
    "tags": [
      "German",
      "Deep",
      "Narrator",
      "Resonant"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-zh-xuefeng",
    "name": "Xuefeng Chen",
    "language": "Chinese",
    "accent": "Standard Mandarin",
    "folderId": "folder-asian-languages",
    "folderName": "Asian Languages & Accents",
    "size": 217678,
    "duration": 6.8,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/mrfakename/E2-F5-TTS/resolve/main/tests/ref_audio/test_zh_1_ref_short.wav",
    "isDownloaded": false,
    "referenceText": "对，这就是我想要向大家展示的全新人工智能语音系统。",
    "speakerGender": "male",
    "timbreDescription": "Official F5-TTS Mandarin reference voice; crystal-clear tonal phonetics and broadcast articulation.",
    "tags": [
      "Mandarin",
      "F5-TTS Benchmark",
      "Tonal",
      "Broadcast"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  },
  {
    "id": "ref-sandy-carousel",
    "name": "Sandy Carousel (Applejack)",
    "language": "English",
    "accent": "US Country Animated",
    "folderId": "folder-animated-characters",
    "folderName": "Animated & Expressive Characters",
    "size": 326700,
    "duration": 7.4,
    "url": "",
    "downloadUrl": "https://huggingface.co/spaces/CodingBillionaire/Voice-TTS-And-Cloning/resolve/main/tortoise/voices/applejack/1.wav",
    "isDownloaded": false,
    "referenceText": "Well howdy there sugarcube! Looks like we got ourselves a whole harvest to bring in today!",
    "speakerGender": "female",
    "timbreDescription": "High-energy, animated Southern country character voice with vibrant vocal dynamics.",
    "tags": [
      "Animated",
      "Character",
      "Southern",
      "Expressive"
    ],
    "createdAt": 1704067200000,
    "isBuiltIn": true
  }
];

/**
 * Full initial catalog: 20 curated stems + 350 generated category samples.
 * storageService merges any missing built-in ids into stored data on load,
 * so new samples appear for existing users without resetting their library.
 */
export const INITIAL_REFERENCE_AUDIOS: ReferenceAudioItem[] = [
  ...CURATED_REFERENCE_AUDIOS,
  ...SAMPLE_REFERENCE_AUDIOS,
];
