# Third-party programs in the worker image

## homr — reading photos and PDFs of printed music

- Source: https://github.com/liebharc/homr (version 0.7.0 from PyPI, with the models its `homr --init` downloads)
- Licence: GNU Affero General Public License v3.0
- How it is used: installed unmodified in its own virtual environment (`/opt/homr`) and run as a separate program,
  one page at a time, by `app/pipeline/sheet_reader.py`, which reads the MusicXML it writes. NoteFusion's code does
  not import, link or change it. Its source is available at the address above.
