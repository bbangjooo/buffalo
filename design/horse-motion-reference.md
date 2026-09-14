# Horse motion reference and visual acceptance

The motion is an unhurried walk, with occasional grazing. It is not a trot or a dressage display.

## References

- [AMNH: Muybridge's 24-frame walk flipbook](https://www.amnh.org/content/download/213774/3146546/file/horse_walk-flipbook.pdf). Compare the support-leg silhouette in frames 1–3 and 10–12 with the recovering foreleg in frames 4–10. Supporting forelegs are nearly straight; pronounced carpal flex belongs to the returning limb.
- [University of Kentucky: horse walk](https://horses.extension.org/horse-walk/). Four-beat sequence: left hind, left fore, right hind, right fore.
- [UC Davis horse skeleton, page 8](https://ceh.vetmed.ucdavis.edu/sites/g/files/dgvnsk4536/files/local_resources/pdfs/pubs-HR29-3-sec.pdf). Distinguish the stifle and hock instead of drawing their bend into one rigid segment.
- [University of Minnesota: horse conformation](https://extension.umn.edu/agriculture/animals-and-livestock/horse/conformation-of-the-horse). Use the relationship between carpus, hock and cannon lengths to keep the legs recognizable in side view.
- [UC Davis teaching herd grazing photograph](https://ceh.vetmed.ucdavis.edu/news/grass-greener-center-equine-health). The whole neck descends and the muzzle reaches grass while the legs support the barrel.

## What failed in the previous animation

The old fore chain was pre-bent about 23.5 degrees away from straight. Lowering the barrel 4.2 cm throughout walking increased that bend to about 39.5 degrees even below the shoulder. The hind stifle was part of a rigid hip-to-hock mesh, so solving every leg as the same two-link triangle produced a permanent crouch. Small circular routes compounded the problem by continually twisting the body over planted feet. Keeping the hoof horizontal throughout recovery made the feet paddle.

The previous grazing pose was also geometrically unreachable: the neck root was about 1.40 m high, but the combined neck-to-poll and poll-to-muzzle lengths were only about 0.975 m. Increasing the animation duration could not make the mouth reach the turf.

Numerical no-slip tests did not establish that the animation looked like a horse. They remain useful checks for a referenced, visually accepted gait, rather than a substitute for one.

## Acceptance

- Inspect continuous motion at full speed and quarter speed, from the side and three-quarter view. Check at least eight successive poses, including support and recovery.
- Supporting forelegs must read as long, near-straight columns. Flexion must change through the stride; all four legs must not stay crouched.
- Hind stifle and hock move independently, with distinct anatomical bends. A hoof folds through recovery and extends toward touchdown.
- The barrel stays tall, with small rhythmic motion. Turning must not twist the entire body over four stationary feet.
- Grazing is a visible sequence: settle, lower the neck, bring the muzzle into the grass, take several bites/chew, raise the head, resume walking.
- Verify actual geometry for hoof contact, reachable mouth height, body clearance and both art themes. Preserve eight horses, two per quadrant, visitor avoidance and reduced motion.

For local visual review, open `/scripts/horse-motion-review.html` on the Vite server. It uses the actual controller and GLBs, offers side/front/three-quarter views, slow motion, frame stepping and a local video download. It is not a production build entry.
