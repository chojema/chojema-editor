import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Placeholder } from '@tiptap/extensions'
import { LocalImage } from '../editor/localImage'
import { MarkdownLinkOpen } from '../editor/linkOpen'
import { SearchHighlight } from '../editor/searchHighlight'
import { t } from '../i18n/locale'
import {
  BareTextBlocks,
  HtmlBlockContainer,
  HtmlInline,
  HtmlTextContainer,
  PreserveAttributes,
} from './preserve'
import { RawHtmlBlock, RawHtmlInline } from './rawHtml'

/** HTML has sized images; markdown does not, so the shared image node gains the two attributes here */
const HtmlImage = LocalImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('width'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('height'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.height ? { height: attrs.height } : {},
      },
    }
  },
})

/** the extension set behind the HTML visual editor */
export function buildHtmlExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, HTMLAttributes: { target: null, rel: null } },
      // the document's own spacing rules decide, not an editor-inserted trailing paragraph
      trailingNode: false,
    }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph', 'htmlTextContainer'] }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    // the resizable table view draws its own <table> and drops the document's class/style on it
    TableKit.configure({ table: { resizable: false } }),
    HtmlImage,
    HtmlBlockContainer,
    HtmlTextContainer,
    HtmlInline,
    RawHtmlBlock,
    RawHtmlInline,
    PreserveAttributes,
    BareTextBlocks,
    MarkdownLinkOpen,
    SearchHighlight,
    Placeholder.configure({ placeholder: () => t('htmlPlaceholder') }),
  ]
}
