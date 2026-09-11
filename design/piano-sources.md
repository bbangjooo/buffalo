# Piano pieces: content and video sources

Updated 2026-09-10. The five works and personal notes come directly from the owner's messages. The order is a display order, not a claimed practice chronology; no performance dates were supplied, so date labels are empty. Titles retain their familiar French, German, or Italian musical names, while the surrounding prose and credits are in English.

The page now shows one short personal note per work, composer and performer credits, and a reference performance. Score descriptions, inferred practice stories, listening instructions, and publisher links have been removed from the displayed content. These recordings feature the credited pianists; they are not recordings of the site owner.

## Selected performances

| Piece | Personal note | Reference performer | YouTube video |
| --- | --- | --- | --- |
| En avril, à Paris | My all-time favorite. | Marc-André Hamelin | [7k2vQgC_hbc](https://www.youtube.com/watch?v=7k2vQgC_hbc) |
| Pathétique Sonata — II. Adagio cantabile | The first piece I learned to play, and the one that sparked my love of classical music. | Daniel Barenboim | [xBZdFMLZlPU](https://www.youtube.com/watch?v=xBZdFMLZlPU) |
| Last Rag | The piece that got me through some of my most stressful days. | Akira Eguchi | [u_ccRDlyO9U](https://www.youtube.com/watch?v=u_ccRDlyO9U) |
| Graceful Ghost Rag | One of my all-time favorites. | Yeol Eum Son | [hwrImDWsqgQ](https://www.youtube.com/watch?v=hwrImDWsqgQ) |
| Träumerei | The piece I get most absorbed in. | Yeol Eum Son | [rImVFozA0NI](https://www.youtube.com/watch?v=rImVFozA0NI) |

## Credit provenance

- **En avril, à Paris:** [Hamelin's official video gallery](https://www.marcandrehamelin.com/video-gallery-full) links to the selected performance. Its YouTube description identifies Hamelin and the Gstaad performance on 6 February 2009. The upload is by `tompilk`, endorsed through the artist's gallery. Charles Trenet and Walter Eiger are credited as composers, and Alexis Weissenberg as arranger in the [Hyperion/UMG recording credits](https://www.youtube.com/watch?v=qgjIYyCw0p8).
- **Pathétique Sonata, second movement:** [the official artist Topic upload](https://www.youtube.com/watch?v=xBZdFMLZlPU), distributed by NAXOS of America, credits Daniel Barenboim, Ludwig van Beethoven, the album *The First Steps to Glory*, and ℗ 2018 Profil. This is an audio recording with album artwork, not filmed concert footage. It was selected after the previously considered filmed uploads failed actual embedded-player checks. The selection is a reference performance and is not asserted to be the exact recording that first inspired the owner.
- **Last Rag:** the [Naxos-distributed upload](https://www.youtube.com/watch?v=u_ccRDlyO9U) credits Akira Eguchi and the 2019 NYS Classics album *Dear America,*. It is an official artist Topic audio recording. The [Albany Records complete-rags release](https://www.albanyrecords.com/catalog/troy0325-26/) confirms William Bolcom as composer; the misspelling `Bolocom` in the selected upload is not reproduced. The work's identity had also been checked against the owner's title page in the previous source review; no score material is shown on the site.
- **Graceful Ghost Rag:** [TomatoClassic's concert video](https://www.youtube.com/watch?v=hwrImDWsqgQ) explicitly credits Yeol Eum Son, William Bolcom, and the 30 September 2021 performance at Seoul Arts Center. This is the single performance, not the channel's one-hour loop. It replaces Richard Dowling's former reference recording.
- **Träumerei:** [MBC TV Art Show’s official video](https://www.youtube.com/watch?v=rImVFozA0NI) explicitly credits Yeol Eum Son, Robert Schumann’s *Träumerei*, and the 26 May 2020 recording at MBC Golden Mouse Hall. This filmed performance replaces the former Horowitz audio and the Lang Lang candidate that was unavailable in the embedded player.

## Availability checks and limits

An initial 2026-09-09 check used oEmbed and watch-page metadata. Browser QA subsequently demonstrated that these are insufficient: Barenboim `vGq3-Fi_zQY` and Lang Lang `9zVQk0YviAA` returned `previewPlayabilityStatus: UNPLAYABLE` from the actual embed endpoint, despite successful watch metadata.

On 2026-09-10, the final replacements—Barenboim `xBZdFMLZlPU`, Träumerei `rImVFozA0NI`, and Graceful Ghost Rag `hwrImDWsqgQ`—each returned `previewPlayabilityStatus.status: OK` and `playableInEmbed: true` from the actual embed endpoint. Root browser QA confirmed that all three reached state `1` (playing) with advancing playback time in the application. Barenboim initially buffered, then passed on retry with readyState `4` and no media error. Their durations are 318, 151, and 259 seconds respectively.

Playback checks apply to the tested browser and moment. They do not prove playback in every browser or region. Player policy, cookies, network filtering, and future availability can still affect playback. The interface retains a direct YouTube link as a fallback and sends an origin referrer through `strict-origin-when-cross-origin`. No audio or video files were downloaded or republished.
