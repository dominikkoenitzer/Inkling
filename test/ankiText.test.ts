import { describe, expect, it } from 'vitest'
import { ankiHtmlToText } from '../src/shared/ankiText'

describe('ankiHtmlToText', () => {
  it('turns line breaks and block ends into newlines and drops other tags', () => {
    expect(ankiHtmlToText('<b>Osmosis</b><br>water<div>across</div><div>a <i>membrane</i></div>').text).toBe(
      'Osmosis\nwater\nacross\na membrane'
    )
    expect(ankiHtmlToText('<ul><li>one</li><li>two</li></ul>').text).toBe('one\ntwo')
    expect(ankiHtmlToText('<p>first</p><p>second</p>').text).toBe('first\nsecond')
  })

  it('decodes entities after the tags are gone, so escaped markup stays text', () => {
    expect(ankiHtmlToText('a&nbsp;&amp;&nbsp;b &lt;br&gt; &#233;t&#xE9; &quot;q&quot; &unknown;').text).toBe(
      'a & b <br> été "q" &unknown;'
    )
  })

  it('removes images, sounds and videos and counts them', () => {
    const out = ankiHtmlToText('Heart <img src="heart.jpg"> [sound:beat.mp3]<video src="x.mp4"></video><img src=\'b.png\'/>')
    expect(out.text).toBe('Heart')
    expect(out.media).toBe(4)
    expect(ankiHtmlToText('no media').media).toBe(0)
  })

  it('keeps MathJax and cloze markup as written', () => {
    expect(ankiHtmlToText(String.raw`\(x^2 &lt; y\) and \[\frac{a}{b}\]`).text).toBe(String.raw`\(x^2 < y\) and \[\frac{a}{b}\]`)
    expect(ankiHtmlToText('{{c1::<b>Paris</b>::capital}} is in {{c2::France}}').text).toBe('{{c1::Paris::capital}} is in {{c2::France}}')
  })

  it('gives list items and blocks one break each, whatever whitespace sits between them', () => {
    expect(ankiHtmlToText("<ol><li>of</li> <li>~'s</li></ol>").text).toBe("of\n~'s")
    expect(ankiHtmlToText('<div>a</div>\n<div>b</div>').text).toBe('a\nb')
    // A <br> between two blocks is a real blank line and stays.
    expect(ankiHtmlToText('<div>a</div><br><div>b</div>').text).toBe('a\n\nb')
  })

  it('ignores source newlines and collapses blank runs', () => {
    expect(ankiHtmlToText('one\ntwo<br><br><br><br>three').text).toBe('one two\n\nthree')
  })
})
