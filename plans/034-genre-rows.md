# Plan 034: Discover's genre pages as rows

Status: BUILT in v1.0.31, retuned in v1.0.32 on Adam's Comedy paste
(fixtures/comedy-sample.json): order-aware rank, one mix per card, more
names. Mockup signed off: https://claude.ai/artifact/Egy5aKhEsii1nyLUv6hKtG

## The problem

A friend, on Discover: "the genre feature on blammytv is sick but the
results are weird". Adam's Comedy grid had Trick 'r Treat, Tulsa King and
Pulp Fiction in it. A genre grid asks every catalog that can take the genre
(`servesGenre`, data.ts) and interleaves them round-robin:

- a catalog that takes a genre filter but lists no genres counts as taking
  any, and one that ignores the filter sends its whole list back;
- a title whose Comedy is a side tag ranks the same as a pure comedy;
- every catalog gets an equal share, so New Releases' unrated 2026 titles sit
  beside Top's.

## Decided

The genre page is rows, top to bottom (the mockup, Comedy):

1. **Popular Comedies, From TMDB.** TMDB's most popular titles in the genre,
   each found in your addons; a title none of them has is left out. Labelled
   "From TMDB" on the row (TMDB's terms want the credit).
2. **Just Comedy.** Tagged Comedy and nothing else.
3. **The mixes your catalogs hold**: Romantic Comedy, Comedy Series, Action
   Comedy, Horror Comedy, Animated Comedy and so on, a row only with at least
   6 titles.
4. **See All** on each row opens it as a grid; **See All Comedy** at the foot
   opens one grid of the lot.

Rows other than TMDB's are ranked the same way: how much of the title is the
genre (fewer genres alongside it first), then popularity, read from where it
sits in your catalogs and in how many, with the rating breaking ties. A card
whose own genres don't include the genre is dropped.

## Before the build

`copy(btvGenreGrid())` on Adam's Comedy grid (genreLog.ts): per card its
catalog and position, genres and rating; per catalog what it declares and
how much of what it sent carries the genre. It decides:

- whether most cards carry genres at all (rows depend on it; without them the
  page falls back to one ranked grid);
- which catalogs ignore the filter (dropping off-genre cards is then the fix);
- which mixes are common, so the row names and the 6-title floor are set on
  real data;
- how a genre is spelt across catalogs (Sci-Fi, Science Fiction).

## Open

- TMDB's row costs a lookup per title in the addons (REC's path, tmdb.ts), and
  carries REC's open licensing question; only builds with the key show it.
- Mix row names: Genre + Genre in the user's words ("Romantic Comedy", not
  "Comedy, Romance"), a small table for the common pairs, else "Comedy and X".
