---
title: "How to Read Tonic Solfa: A Complete Beginner's Guide"
description: "Learn to read Tonic Solfa: the seven syllables, doh and keys, octave marks, rhythm, la-based minor and chromatic notes, with hymns to practise."
dek: "Everything a new singer needs to sing from a solfa sheet: the seven syllables, where doh sits, octave marks, rhythm and minor keys, with real hymns to practise on."
date: "2026-10-15"
author: francis
tags: [tonic-solfa, beginners, choir]
keyword: how to read tonic solfa
hymns: [amazing-grace, praise-god-from-whom-all-blessings-flow, joyful-joyful-we-adore-thee]
faq:
  - q: "Is Tonic Solfa the same as do re mi?"
    a: "It uses the same idea. Tonic Solfa names the notes of the scale d r m f s l t (doh, ray, me, fah, soh, lah, te), and doh is always the key note of the song, wherever that falls on a piano. That is called movable doh."
  - q: "Is doh always C?"
    a: "No. Doh is the key note, so it changes with the key. A song in G has doh on G, a song in Bb has doh on Bb. The line at the top of a solfa sheet, such as \"Doh is G\", tells you where it is."
  - q: "What do the commas and apostrophes after the notes mean?"
    a: "They show the octave. A comma after a note (s,) means the octave below the main one, and an apostrophe (d') means the octave above. Some hymn books print a small number below or above the letter instead; it means the same thing."
  - q: "How long does it take to learn to read Tonic Solfa?"
    a: "The syllables and the octave marks can be learnt in one sitting. Reading new tunes fluently comes from regular practice: a few minutes a day singing tunes you already know from the solfa is the quickest route."
  - q: "How do I read a song in a minor key?"
    a: "Most choirs in Nigeria and West Africa read minor keys la-based: the tune is written as if it were in the relative major, so a song in A minor has doh on C and its home note is l. The syllables keep the same meaning as in major."
---
Tonic Solfa is how a great many choirs across Nigeria and West Africa learn new music. A director writes the solfa on a board or sends it on WhatsApp, and within a rehearsal the sopranos, altos, tenors and basses are singing it. If you have ever stood in a choir and felt lost when someone said "start on soh", this guide is for you.

I built NoteFusion so that any song — a recording, a hummed tune, a link — can be written out in Tonic Solfa in seconds. But the solfa is only useful if you can read it, so let's start there. By the end of this guide you will know the seven syllables, how doh moves from key to key, what the commas and apostrophes mean, how rhythm is written, and how minor keys work. Every solfa example below was written by NoteFusion's own solfa engine from the real melody, so you can trust what you see.

## What Tonic Solfa is

Tonic Solfa is a way of writing music with syllables instead of notes on a staff. It was developed in England in the nineteenth century, most famously by John Curwen, as a way to teach congregations and schoolchildren to sing from notation. It travelled with churches and mission schools, and it is still how many choirs read music today.

The big idea is that every note is named by its place in the key, not by its fixed pitch. The key note is always **doh**. The note above it is always **ray**, and so on up the scale. A tune that goes "doh, me, soh" sounds like the same tune whether you sing it high or low, because the syllables describe the shape of the melody, not the piano keys. This is called **movable doh**, and it is why solfa is so quick for singers: once you know how the syllables sound against each other, you can sing in any key.

## The seven syllables

There are seven notes in a major scale, and each has a syllable. In written solfa we use the first letter of each:

| Letter | Say it | Place in the scale |
|---|---|---|
| d | doh | 1st — the key note, home |
| r | ray | 2nd |
| m | me | 3rd |
| f | fah | 4th |
| s | soh | 5th |
| l | lah | 6th |
| t | te | 7th — leads back up to doh |

Here is the scale of G major written the way NoteFusion writes it, with the solfa on top and the letter names underneath:

```solfa
scale: G major
```

Sing it slowly from bottom to top. Notice how te wants to rise to doh, and how doh at the top feels like coming home. That feeling of "home" is the key to everything else in this guide.

## Doh moves with the key

At the top of every solfa sheet you will see a line like **Doh is G**. That line is the only place the pitch is fixed: it tells you which note on the piano (or which note your director hums) is doh. Everything else is relative to it.

Here is the opening line of [Amazing Grace](/hymns/amazing-grace) in G, the key most hymn books use:

```solfa
hymn: amazing-grace
bars: 1-5
```

And here is exactly the same line moved down a tone to F, which suits lower voices:

```solfa
hymn: amazing-grace
bars: 1-5
key: F major
```

The solfa did not change at all. Only the "Doh is" line changed. This is the great strength of solfa for choirs: when your director decides a song is too high for the sopranos, nobody has to learn new notes. You find the new doh and sing what you already know. If you are not sure how to find doh, I have written a separate guide on [how to find the doh of any song](/blog/how-to-find-the-doh-of-a-song).

## Octave marks: commas and apostrophes

A tune often goes below doh or above the next doh. Solfa shows this with a small mark after the letter:

- **A comma (s,)** means the octave below. In Amazing Grace above, the first note is s, — the soh *below* doh, not the one above it.
- **No mark (s)** means the main octave, from doh up to te.
- **An apostrophe (d')** means the octave above.

Some older hymn books print these as a small number under or over the letter, or as a short line. They mean the same thing: lower octave or upper octave.

Getting the octave right matters more than it looks. If the sopranos miss the comma and sing s instead of s,, they will start a fifth *above* doh when the tune actually starts a fourth *below* it, and the whole line will feel wrong. When you first read a new song, look along the line for commas and apostrophes before you sing.

## Reading rhythm

Solfa shows rhythm with the spacing of the notes inside each bar, not with note shapes. In NoteFusion's layout every bar is split into equal cells, and **each cell is half a beat**:

- A **letter** is a new note starting on that half beat.
- A **dash (-)** means "keep holding the note before it".
- An **underscore (_)** is silence — a rest.
- The **vertical lines** are bar lines.

Look at the first line of [Joyful, Joyful, We Adore Thee](/hymns/joyful-joyful-we-adore-thee), which is in 4/4 time, so each bar has four beats and eight cells:

```solfa
hymn: joyful-joyful-we-adore-thee
bars: 1-4
```

The first bar has four notes, each followed by one dash: four notes of one beat each. In the last bar, the first note is followed by two dashes — it lasts a beat and a half — then a note that lasts only half a beat, then a note held for two beats. Count it out loud, "one-and-two-and-three-and-four-and", moving along one cell for each word, and the rhythm reads itself.

Older printed solfa uses a different style: a colon between beats and a full stop between half beats. It is the same information. Once you can count cells, you can learn that style in a few minutes.

Watch for **pickups**, too. Amazing Grace starts with a single note before the first full bar — "A-" — so the first bar line comes after it. Many hymns start like this. Count the pickup as the last beat of an imaginary bar and the stress will fall in the right place on "maz".

## Minor keys: la-based minor

Some songs sound darker, sadder or more serious. Most of them are in a **minor key**. The way most choirs in Nigeria and West Africa read a minor key is called **la-based minor**: the song keeps the doh of its relative major, and its home note becomes **lah**.

So a song in A minor is written with **Doh is C**, and it ends on l, rather than d. Here is the A minor scale:

```solfa
scale: A minor
```

The syllables keep exactly the same meaning they have in major — doh is still doh, me is still me — which means you never have to learn a second set of names for minor keys. Many minor tunes raise the seventh note on the way up to home. In solfa that raised note gets its own name, **se** (from soh, sharpened):

```solfa
scale: A minor
harmonic: true
```

## Sharps and flats inside a key

Sometimes a tune uses a note that is not in its key. Solfa changes the vowel of the syllable to show it:

- A note **raised** a semitone takes an **e** sound: fah becomes **fe**, soh becomes **se**, doh becomes **de**.
- A note **lowered** a semitone takes an **a** sound: te becomes **ta**, me becomes **ma**, lah becomes **la**.

You will meet fe and ta most often in hymns. When you see one, sing it as a step "between" its neighbours, and listen to the piano or your section leader the first few times.

## Practise with a real hymn

The best way to learn is with a tune you already know. [The Doxology](/hymns/praise-god-from-whom-all-blessings-flow) is perfect: every line starts and ends on a long note, and it moves mostly by step. Here are its first two lines:

```solfa
hymn: praise-god-from-whom-all-blessings-flow
bars: 1-5
```

Try this routine:

1. **Find doh.** The sheet says Doh is G. Play G, or have someone hum it, and sing *d r m f s* up from it.
2. **Find the first note.** It is d — doh itself — so you can start straight away.
3. **Sing the solfa slowly, without the words.** Say the syllables in rhythm first, then sing them. Notice that the line walks down from d to s, through t, and l, — commas, so below doh.
4. **Add the words.** Once the solfa is comfortable, sing the same notes to "Praise God, from whom all blessings flow".
5. **Check yourself.** Each hymn page on NoteFusion has a Play button: listen and compare.

When that feels easy, move on to [Amazing Grace](/hymns/amazing-grace) and [Joyful, Joyful](/hymns/joyful-joyful-we-adore-thee), then pick any hymn from the [hymns in Tonic Solfa](/hymns) collection.

## Mistakes almost every beginner makes

- **Treating doh as C.** Doh is wherever the "Doh is" line says it is. If you have learnt fixed do in school, this is the habit to unlearn.
- **Ignoring the octave marks.** s, and s are an octave apart. Read the marks before you sing.
- **Rushing the dashes.** A dash is part of the note. A note with three dashes after it lasts two full beats, not one.
- **Starting on the wrong beat.** Check whether the song has a pickup before the first bar line.
- **Reading minor keys as major.** If the sheet says Doh is C but the tune keeps landing on l, it is la-based minor. Let lah be home.

## Getting solfa for the songs your choir actually sings

Hymns are a good place to learn, but most choirs also need solfa for new songs: a chorus from a recording, a song from YouTube, a tune someone hums in rehearsal. Writing those out by ear takes time, and it is easy to get a note or an octave wrong.

That is the job NoteFusion does. You can [open NoteFusion in your browser](/app), hum a tune, upload a recording or paste a song link, and it writes the melody in movable-doh Tonic Solfa — la-based for minor keys, with octave marks and rhythm laid out exactly like the examples above — together with the staff notation. Then you can play it back, change the key for your choir, and share it.
