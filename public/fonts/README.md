# Font sources and licenses

The local WOFF2 files are unmodified official releases. Each is distributed with its original SIL Open Font License 1.1 notice.

| File | Version | Official source | License |
| --- | --- | --- | --- |
| `PretendardVariable.woff2` | v1.3.9 | https://github.com/orioncactus/pretendard/tree/v1.3.9 | `Pretendard-OFL.txt` |
| `WantedSansVariable.woff2` | v1.0.1 | https://github.com/wanteddev/wanted-sans/tree/v1.0.1 | `WantedSans-OFL.txt` |

Clash Display and General Sans are loaded from Fontshare's official CSS API. Their font binaries are not included in this repository. Fontshare's ITF Free Font License permits use on the end user's website; see https://www.fontshare.com/licenses/itf-ffl. Noto Serif KR is loaded through Google's official Fonts CSS API; its official project is https://github.com/notofonts/noto-cjk and it uses SIL OFL 1.1.

Typography reference: computed styles and linked stylesheets on https://junepark.kr/about, inspected on 2026-09-08. English display uses Clash Display, Korean display fallback uses Wanted Sans Variable, About prose declares General Sans with Noto Serif KR fallback, and Korean interface/help/footer text uses Pretendard Variable. These font choices do not copy that site's prose or layout.

The General Sans API request is separate because the reference's combined request returned Satoshi declarations rather than General Sans during inspection. The standalone General Sans response was checked to contain the intended family.

The pre-existing `Rubik Vinyl_Regular.json` asset is outside this font addition.
