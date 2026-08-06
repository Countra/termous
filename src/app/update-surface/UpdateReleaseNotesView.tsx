import { Fragment, useMemo } from 'react'
import { Typography } from 'antd'
import {
  parseUpdateReleaseNotes,
  resolveUpdateReleaseNotesContent,
  tokenizeUpdateReleaseNoteInline,
} from './updateReleaseNotes'
import styles from './UpdateWindowRoot.module.scss'

export function UpdateReleaseNotesView({
  fallback,
  label,
  notes,
}: {
  fallback: string
  label: string
  notes: string | null
}) {
  const blocks = useMemo(
    () => parseUpdateReleaseNotes(
      resolveUpdateReleaseNotesContent(notes, fallback),
    ),
    [fallback, notes],
  )

  return (
    <div
      className={styles['update-window-release-notes']}
      role="document"
      aria-label={label}
      tabIndex={0}
    >
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Typography.Title
              className={[
                styles['update-window-release-heading'],
                block.level <= 2
                  ? styles['is-release-heading']
                  : styles['is-section-heading'],
              ].join(' ')}
              key={`heading-${index}`}
              level={block.level <= 2 ? 4 : 5}
            >
              <ReleaseNoteInline text={block.text} />
            </Typography.Title>
          )
        }

        if (block.type === 'paragraph') {
          return (
            <Typography.Paragraph
              className={styles['update-window-release-paragraph']}
              key={`paragraph-${index}`}
            >
              <ReleaseNoteInline text={block.text} />
            </Typography.Paragraph>
          )
        }

        if (block.type === 'code') {
          return (
            <pre
              className={styles['update-window-release-code']}
              key={`code-${index}`}
            >
              <code>{block.text}</code>
            </pre>
          )
        }

        const List = block.type === 'ordered-list' ? 'ol' : 'ul'
        return (
          <List
            className={styles['update-window-release-list']}
            key={`${block.type}-${index}`}
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${itemIndex}-${item}`}>
                <ReleaseNoteInline text={item} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}

function ReleaseNoteInline({ text }: { text: string }) {
  return tokenizeUpdateReleaseNoteInline(text).map((token, index) => {
    if (token.type === 'strong') {
      return (
        <Typography.Text
          className={styles['update-window-release-inline']}
          key={`${token.type}-${index}`}
          strong
        >
          {token.text}
        </Typography.Text>
      )
    }
    if (token.type === 'code') {
      return (
        <Typography.Text
          className={styles['update-window-release-inline']}
          key={`${token.type}-${index}`}
          code
        >
          {token.text}
        </Typography.Text>
      )
    }
    return (
      <Fragment key={`${token.type}-${index}`}>
        {token.text}
      </Fragment>
    )
  })
}
