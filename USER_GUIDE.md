# Local AI Voice Studio - User Guide

Local AI Voice Studio turns text into speech, clones voices from a short recording, and dubs videos or audio into another language.
Everything runs on **your own computer** (GPU or CPU). Your text, voices and audio are not uploaded anywhere; the internet is only used to download models and software components.

---

## 1. Before you start

| | Minimum | Recommended |
|---|---|---|
| System | Windows 10/11 (64-bit), macOS 12+, Linux (64-bit) | same |
| Memory (RAM) | 8 GB | 16 GB or more |
| Graphics card | none (CPU works, but slowly) | NVIDIA GPU with 6 GB+ VRAM |
| Free disk space | 15 GB | 40 GB or more (models are large) |
| Internet | needed once for downloads | |

**GPU or CPU?** An NVIDIA GPU makes generation many times faster. On CPU, Qwen3-TTS can take longer to produce a sentence than the sentence lasts. It still works, so start with short texts.

---

## 2. Installing

### Windows
1. Run **Local-AI-Voice-Studio-Setup-x.y.z.exe**. (Windows SmartScreen may warn about an unknown publisher because the installer is not code-signed: click *More info* then *Run anyway*.)
2. **Choose Install Location** - this is the program itself (about 400 MB). Click *Browse* and pick any drive or folder: `C:`, `D:`, `E:` ...
3. **Choose Data Folder** - this is where the big files go: models and voice engines (5-40 GB). Pick a **drive with plenty of free space** from the *Drive* list or *Browse*. The free space of the chosen drive is shown.
4. Finish. A desktop and Start-menu shortcut are created. The data folder you chose is used automatically at first start.

You can move the data folder later: *Settings -> Storage locations -> Change*.

### macOS
- **.dmg** - open it and drag *Local AI Voice Studio* into **Applications**, or into any folder on any disk.
- **.pkg** - double-click; at *Destination Select* click *Change Install Location...* to choose another disk.
- Two builds exist: `x64` (Intel) and `arm64` (Apple Silicon: M1/M2/M3/M4).
- First launch: because the app is not notarized, right-click it, choose **Open**, then **Open** again.
- Change the data folder in *Settings -> Storage locations*.

### Linux
- **.AppImage** - no installation: put it on any disk, `chmod +x`, double-click or run it.
- **.deb** - `sudo apt install ./local-ai-voice-studio_x.y.z_amd64.deb`.
- **.tar.gz + install-linux.sh** - run `./install-linux.sh`; it lists your disks with free space and **asks for the install folder and the data folder**, then adds an application-menu entry.
- Change the data folder in *Settings -> Storage locations*.

---

## 3. First start: three steps

The first time, a welcome window appears. After that, to make speech you need (1) the voice engine, (2) a model, (3) the model loaded.

1. **Set up the voice engine** - *Settings -> Voice Engines & Dependencies*, open the model (for example *Qwen3-TTS 0.6B Base*), press **Set up automatically**. It installs a private Python and PyTorch for your computer (CUDA for NVIDIA GPUs, otherwise CPU). It shows speed, time left and can be **paused and resumed**; if you close the app, it continues next time. Nothing is installed system-wide.
2. **Download the model** - *Models* page, find the model, press **Download**. Large downloads can be paused, resumed after a restart, and are checked against checksums. The *Models* page shows **Incomplete** if parts are missing; press Download again to finish only those parts.
3. **Load it** - press **Load Model** on that model's card. The status becomes *Loaded*.

If something is slow, *Settings -> Voice Engines & Dependencies -> Test connection* tells you whether Hugging Face, PyPI, PyTorch and GitHub are reachable.

---

## 4. A tour of the app

| Sidebar item | What it is for |
|---|---|
| **Generate** | Type or paste text, choose a voice, create speech. |
| **Dubbing** | Translate and re-voice speech from a video or audio file. |
| **Voices** | Your library of reference voices (clips used for cloning) and voice personas. |
| **Models** | Download, load, unload, repair models. See your hardware and recommended models. |
| **History** | Everything you generated: play, export as WAV, load back into the studio. |
| **Settings** | Compute device, storage locations, download speed limit, audio export, theme. |

---

## 5. Tutorial: make speech (Generate page)

### 5.1 Clone a voice with Qwen3-TTS 0.6B Base
This model has no built-in voices: it copies the voice of a **reference clip**.

1. Open **Generate**. Under *Model Architecture* choose *Qwen3-TTS 0.6B Base* (it must be loaded - see section 3).
2. In **Zero-Shot Reference Voice Samples** pick a reference voice from the drop-down. Choose *Open folders* to browse the library, or *Add new* to upload your own clip (see section 6).
3. Choose the **Language** of your text.
4. Type or paste your text in the **Script Editor**. The character and word count and an estimated duration are shown.
5. Press **Generate Speech**.

While it works, a **monitor card** shows:
- **GPU / CPU** badge - where the engine really runs. If you have an NVIDIA GPU but see *CPU*, open Settings -> Voice Engines & Dependencies and press **Repair** on the model to install the CUDA build.
- Segment *x / y*, elapsed time, estimated time left, and a live line such as *Generating on GPU: 6.4 s of audio so far, 9 s elapsed*.

Long texts are split into **segments** at sentence ends (shown in the *Generation Queue*). When all segments are done they are **merged automatically** into one track in *Generated Speech Output*, with natural pauses and matched loudness.

### 5.2 Pause, Stop, Resume, Delete
- **Pause** - the segment being made finishes, then the engine waits. What is done is merged so you can listen. Press **Continue** to go on.
- **Stop** - ends the engine job immediately (it frees GPU/CPU within a moment). Everything already finished is kept and merged.
- **Resume (n left)** - after Stop or a failure, generates only the unfinished segments. It uses your *current* voice settings, so do not change the voice in between if you want one consistent voice.
- **Delete** - discards the generated audio of the current script (entries already in History stay).
- **Merge n finished** (in the Generation Queue) - rebuilds the single track from the finished segments.
- In the queue, each finished segment has **play** and **regenerate** buttons; a failed one shows **Retry**. Regenerating one segment updates the merged track.

A segment that fails is retried once automatically.

### 5.3 Settings under the editor
- **Speed** and **Pitch** - speed keeps the pitch; pitch (semitones) keeps the duration. Best within +-6 semitones.
- **Emotion** and **Style instruction** - used by models that support descriptions (for example VoiceDesign, Parler).
- **Temperature** - lower = steadier and more predictable, higher = more varied. 0.6-0.8 is a good range.
- **Pause between segments** - silence between pieces (a longer pause is added after paragraphs).
- **Volume** - final loudness of the merged file.

### 5.4 Save the result
In the player use the download button to save a **WAV** file. The result is also stored in **History**. *Save Session* keeps your script and settings as a project.

### 5.5 Other models (short)
| Model | Needs | Good for |
|---|---|---|
| Kokoro 82M | nothing (built-in voices) | fast, light, runs well on CPU |
| Qwen3-TTS 0.6B Base | reference clip (3-20 s) | voice cloning |
| Qwen3-TTS 1.7B VoiceDesign | a voice description | invent a voice from words |
| F5-TTS | reference clip **and its exact transcript** | cloning |
| Chatterbox | optional clip | expressive speech |
| XTTS-v2 | optional clip (non-commercial licence) | multilingual cloning |
| Parler-TTS / Indic Parler | voice description | Indian languages (type text in its own script) |

---

## 6. Tutorial: voices (Voices page)

### 6.1 Download voices
Open **Voices -> Voice & Reference Studio**. Catalogue voices are listed in folders. Press the **download** icon on a voice; it is saved on your computer and keeps working after you restart the app. After downloading you can press **Use in Studio (Clone)**.

Each voice has three small actions: **Download / download again**, **Remove** (deletes the downloaded audio; the voice stays and can be downloaded again) and **Locate file** (opens its folder with the file selected).

### 6.2 Add your own voice
Press **Add Audio Reference**, upload a clip (WAV/MP3/M4A/OGG) or drop it on the uploader in the Generate page. Your clip is stored with the app and survives restarts. Use **Dedicated Folders** to organize voices.

**Good reference clips**
- 5-20 seconds of **one** person speaking, clean and clear.
- No music, no echo, no background noise, no overlapping speakers.
- Natural speaking style that matches how you want the result to sound.
- Type the exact words spoken in the optional transcript box: it noticeably improves cloning quality (and is **required** for F5-TTS).

### 6.3 Voice personas
**Create Persona** saves a named voice with gender, language and a description / style prompt (used by models with preset voices or descriptions).

### 6.4 Use only voices you have the right to use
Clone **your own voice, or a voice whose owner gave you permission**. Do not impersonate real people or mislead others.

---

## 7. Tutorial: dubbing (Dubbing page)

Dubbing = recognize speech -> translate -> speak the translation in a cloned voice, timed to the original.

1. First time: press **Set up Dubbing** (installs the dubbing components and the speech recognition and translation models; pausable). **Check my setup** verifies everything.
2. Choose a video or audio file.
3. Set **Spoken language** (or *Auto-detect*), **Dub into**, **Speech recognition** (large = best, small = light) and the **Voice cloning model**. Choose *One speaker* or multiple speakers if offered.
4. Tick the consent box (you have the right to dub this material and to clone the voice) and press **Analyze**.
5. **Review** the table: the recognized text and the translation for each sentence. Edit any translation you want to improve.
6. Press **Dub**. Each sentence is spoken in the cloned voice and placed on the original timing.
7. Check the result in the table (**Play** per sentence). If timing is off, press **Re-fit timing** (re-mixes without speaking again).
8. **Save audio**, or for video input **make a video** with the new audio.

---

## 8. The Models page

- **Download / Pause / Resume / Cancel** - downloads are multi-connection and resumable.
- **Verify** - checks the files on disk. **Repair** - downloads only missing parts.
- **Load Model / Unload** - loading puts the model in memory; **Unload** (or *Clear VRAM*) frees memory. Only load what you use.
- **Add Local Model** - use a model folder you already have on disk.
- **Hugging Face token** - free; only needed for gated models (for example Indic Parler-TTS). Create it at huggingface.co and accept the model's terms first (*Agree / Access repository*).
- **System Specification Analysis** shows your GPU, RAM and CPU and a **Recommended for your system** model.

---

## 9. Settings

- **Compute Engine & Device** - Auto, GPU or CPU; GPU model and VRAM are shown.
- **Auto-Unload Inactive Models** - frees memory after the engine has been idle (default 10 minutes). The engine restarts on the next generation.
- **Storage locations** - shows where **models** and **voice engines (environments)** are stored, with free space. *Change* a folder, then choose **Move everything** (recommended: files are copied, verified, and only then removed from the old place; same drive = instant) or **Use folder without moving**. Voices are in the app's data folder (*Open* shows it).
- **Download speed limit** - leave unlimited, or cap it to keep your internet usable.
- **Audio Rendering & Export** - sample rate and processing of the exported audio. **Interface Appearance** - dark or light.

---

## 10. History

Every generated result (also a partial one after Stop) is listed with model, voice, language, length and size. Use **Load in Studio** to bring the settings back, **Export WAV** to save the audio, or **Clear History**.

---

## 11. Tips for the best results

- Use **GPU** for anything longer than a paragraph. On CPU, split big projects into chapters.
- Write the text the way it should be spoken: spell out numbers/abbreviations if they come out wrong, use normal punctuation - full stops and commas control rhythm and pauses.
- Keep one consistent reference clip and settings for a whole project.
- If one sentence sounds wrong, **regenerate that segment** (the random sampling gives a different take).
- Lower temperature if the voice wobbles; raise it slightly if it sounds flat.
- Close other GPU-heavy programs (games, video editors) while generating.

---

## 12. Troubleshooting

| Problem | What to do |
|---|---|
| Voice starts fine, then glitches / garbles after a few seconds | See **"Glitching voice"** below. |
| Generation seems stuck | Look at the monitor card: if the *seconds of audio* number grows, it is working (CPU is slow). Press **Stop** to end it at any time. |
| Monitor says **CPU** but you have an NVIDIA GPU | Settings -> Voice Engines & Dependencies -> Repair (installs CUDA PyTorch). Update your NVIDIA driver if it says the driver is too old. |
| "Out of memory" / engine stopped | Close other programs, use a smaller model, or turn on Low Memory Mode. Then press **Resume**. |
| Voice plays once but is gone after restart | Fixed in this version. Voices saved by older versions have no stored audio and show **Audio missing**: delete and add the clip again. |
| "Model incomplete" | Models page -> Download (finishes only the missing files) or **Repair**. |
| Downloads are slow or fail | Settings -> Test connection. Check VPN/proxy/antivirus; set `HF_ENDPOINT` to a mirror if Hugging Face is slow in your region. |
| Windows SmartScreen / macOS "unidentified developer" | The installers are not code-signed. Windows: *More info -> Run anyway*. macOS: right-click -> Open. |
| Antivirus blocks the Python engine | Add the data folder to the antivirus exclusions. |
| Need logs | Installation logs are in `<data folder>/runtime/logs/<engine>.log`. |

---

### Hindi and other Indian languages (Indic Parler-TTS)
- **Use a model that supports your language.** Qwen3-TTS does not speak Hindi/Urdu/Tamil etc. (it supports Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian). For Indian languages use **Indic Parler-TTS** (built-in speakers such as Divya/Rohit for Hindi), **Sooktam-2** (cloning, needs a clip + its transcript) or **Svara**.
- **Punctuate the script.** Speech models use punctuation to know where a sentence ends. Text copied from subtitles or speech-to-text has none, and the voice then runs on, repeats words or stalls. The app now inserts the missing marks in unpunctuated Hindi (question mark before "क्या", comma before "लेकिन / बल्कि / ताकि / क्योंकि", a danda at sentence ends), but your own punctuation is always better: end every sentence with **।**, **?** or **!**.
- Pieces for Indic Parler are cut at about 130 characters; each piece is checked, retried if it runs away or stalls, and long silent gaps are removed.
- Write in Devanagari (Urdu-style words like इख्तिताम are fine, but plain Hindi spelling is spoken most reliably). Name a speaker in the Style Instruction box, e.g. *"Divya's voice is clear and expressive with a moderate speed and pitch, in a very close recording with almost no background noise."*

### Glitching voice (clean at first, then garbled)
This happens with small cloning models (like Qwen3-TTS 0.6B) and has a few known causes. The app now guards against the ones it can; for the rest, try in this order:
1. **Add the transcript** of the reference clip (the exact words spoken). This is the single biggest quality improvement.
2. **Use a better reference clip**: 5-12 seconds, one speaker, no music/echo/noise, normal speaking pace, no long silence. The app trims silence and normalises the level automatically, and clips longer than 15 s are used in a safe mode.
3. **Lower Temperature** to 0.5-0.7.
4. **Keep Speed = 1.0 and Pitch = 0** while testing: speed/pitch processing can add a "warble" of its own.
5. **Use shorter sentences.** The 0.6B model drifts on long pieces; segments are now cut at about 150 characters.
6. Press **regenerate** on the bad segment: each take is random. The app also re-tries by itself when a take runs away (too long for its text, or corrupt).
7. **Test the model vs the software:** generate the same sentence with **Kokoro** (no cloning). If Kokoro is clean, the software and your speakers are fine and the glitch comes from the cloning model/reference clip. If Kokoro glitches too, tell us your GPU/CPU and the log.
8. If you have an NVIDIA GPU older than RTX 30 (GTX 10/16, RTX 20, T4), the engine now runs Qwen3 in full precision instead of half precision, which removes a known source of garbled audio (slower, but clean).
9. Need a more stable voice? Use a larger or different cloning model: **Qwen3-TTS 1.7B** (if you have 8 GB+ VRAM), **Chatterbox**, or **F5-TTS** (give it the exact transcript).

---

## 13. Uninstalling
- Windows: *Settings -> Apps -> Local AI Voice Studio -> Uninstall*. Models, voices and history are **kept**; delete the data folder yourself if you want the space back.
- macOS: delete the app from Applications. Linux: remove the folder / `sudo apt remove local-ai-voice-studio`.
- Your data folder and the app's data folder (`%APPDATA%\Local AI Voice Studio`, `~/Library/Application Support/Local AI Voice Studio`, `~/.config/Local AI Voice Studio`) can be deleted manually.

---

## 14. For developers: building the installers
See `PACKAGING_GUIDE.md`. In short: `npm install --legacy-peer-deps`, then `npm run dist:win`, `dist:mac` or `dist:linux` (each writes to its own folder under `release/`). The GitHub Actions workflow builds all three.
