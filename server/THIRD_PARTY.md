# Third-party programs in the worker image

## homr — reading photos and PDFs of printed music

- Source: https://github.com/liebharc/homr (version 0.7.0 from PyPI, with the models its `homr --init` downloads)
- Licence: GNU Affero General Public License v3.0
- How it is used: installed unmodified in its own virtual environment (`/opt/homr`) and run as a separate program,
  one page at a time, by `app/pipeline/sheet_reader.py`, which reads the MusicXML it writes. NoteFusion's code does
  not import, link or change it. Its source is available at the address above.

## Tesseract — reading the words printed on a page of music

- Source: https://github.com/tesseract-ocr/tesseract (Debian's `tesseract-ocr` and `tesseract-ocr-eng` packages)
- Licence: Apache License 2.0
- How it is used: run as a separate program (`NF_OCR_BIN`, default `tesseract`) by `app/pipeline/page_words.py` on the
  first pages of a photographed or PDF score, to read the title and words printed there and name the hymn among those
  sung to the matched tune. The text is used for that job only and kept nowhere.
