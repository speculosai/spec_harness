/**
 * The chat side of the workspace.
 *
 * The transcript is deliberately calm: one legible line per tool call ("Wrote
 * App.tsx"), never a function name or a blob of JSON, and a failed tool renders the
 * same as a successful one - the agent sees the error and retries, and a red cross the
 * user cannot act on only creates anxiety. The full output is still on the item for
 * anyone debugging.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, ReactElement, ReactNode } from 'react';
import type { Attachment } from '../protocol';

import { useHarness } from './context';
import { AttachIcon, CheckIcon, CloseIcon, SendIcon, SheetIcon, SpinnerIcon, StopIcon } from './icons';
import { describeTool, isAssistantItem, isToolItem, isUserItem } from './items';
import type { AssistantChatItem, ToolChatItem, UserChatItem } from './items';
import { Markdown } from './markdown';
import { parseAssistantSegments } from './choices';
import type { ChoiceOption, ChoiceSpec } from './choices';
import { useHarnessChat } from './useHarnessChat';
import type { ChatActivity, HarnessChat } from './useHarnessChat';
import type { Translate } from './strings';

/** 6 MB per image, 4 MB per CSV - both comfortably under a typical body limit. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_CSV_BYTES = 4 * 1024 * 1024;

/** Props for {@link ChatPane}. */
export interface ChatPaneProps {
  /** The project the conversation belongs to. */
  projectId: string;
  /** Optional slot rendered above the composer (starter suggestions, connector chips). */
  header?: ReactNode;
  /**
   * Seed the composer on first mount - the `?prompt=` deep-link convention. The text
   * is prefilled, not sent, so the user lands one click away from a build.
   */
  initialInput?: string;
}

function planStorageKey(projectId: string): string {
  return `speculos-harness.planMode.${projectId}`;
}

function modelStorageKey(projectId: string): string {
  return `speculos-harness.model.${projectId}`;
}

function readStored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* a host may block storage; the setting simply does not persist */
  }
}

function countRows(text: string): number {
  const newlines = (text.match(/\n/g) ?? []).length;
  return newlines + (text.endsWith('\n') ? 0 : 1);
}

/**
 * The chat side: the message log with legible tool cards, plan-mode choice chips, the
 * model picker, and the composer with image/CSV attachment support. Talks the protocol
 * through {@link useHarnessChat}.
 */
export function ChatPane(props: ChatPaneProps): ReactElement {
  const { projectId, header, initialInput } = props;
  const { t, auth, capabilities, bus } = useHarness();
  const chat = useHarnessChat({ projectId });
  const canEdit = auth.canEdit !== false;

  const [input, setInput] = useState(initialInput ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<'off' | 'undone' | null>(null);

  // `null` means "not decided by the user": plan mode is on for a fresh project and
  // off once there is a conversation, which is what people expect without ever having
  // to find a toggle.
  const [planChoice, setPlanChoice] = useState<boolean | null>(() => {
    const stored = readStored(planStorageKey(projectId));
    return stored === 'on' ? true : stored === 'off' ? false : null;
  });
  const [model, setModel] = useState<string>(() => readStored(modelStorageKey(projectId)) ?? '');

  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatRef = useRef<HarnessChat>(chat);
  chatRef.current = chat;

  const planMode = capabilities.planMode && (planChoice ?? chat.items.length === 0);
  const models = useMemo(() => capabilities.models ?? [], [capabilities.models]);
  const acceptsImages = capabilities.attachments.includes('image');
  const acceptsCsv = capabilities.attachments.includes('csv');
  const canAttach = acceptsImages || acceptsCsv;

  const setPlan = useCallback(
    (on: boolean) => {
      setPlanChoice(on);
      writeStored(planStorageKey(projectId), on ? 'on' : 'off');
    },
    [projectId],
  );

  useEffect(() => {
    if (model) writeStored(modelStorageKey(projectId), model);
  }, [model, projectId]);

  // A model that is no longer offered falls back to the server default rather than
  // being sent and rejected.
  useEffect(() => {
    if (model && models.length > 0 && !models.includes(model)) setModel('');
  }, [model, models]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.items, chat.activity]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(240, node.scrollHeight)}px`;
  }, [input]);

  // The preview asks for a repair through the bus, so a chat in a drawer and a
  // preview in a modal still form the crash-to-fix loop.
  useEffect(
    () =>
      bus.onSendRequest(projectId, (text) => {
        if (!canEdit || chatRef.current.busy) return false;
        chatRef.current.send(text, { planMode: false });
        return true;
      }),
    [bus, projectId, canEdit],
  );

  const submit = useCallback(
    (override?: string, opts?: { planMode?: boolean }) => {
      const text = (override ?? input).trim();
      const turnAttachments = override === undefined ? attachments : [];
      if ((!text && turnAttachments.length === 0) || chat.busy) return;
      if (override === undefined) {
        setInput('');
        setAttachments([]);
      }
      setPlanNotice(null);
      chat.send(text, {
        planMode: opts?.planMode ?? planMode,
        model: model || undefined,
        attachments: turnAttachments,
      });
    },
    [attachments, chat, input, model, planMode],
  );

  const ingest = useCallback(
    async (list: FileList | File[]) => {
      const added: Attachment[] = [];
      for (const file of Array.from(list)) {
        const isImage = file.type.startsWith('image/');
        const isCsv = file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || /\.csv$/i.test(file.name);
        // A file that cannot be read is a notice, never a rejected promise nobody
        // catches - the composer has to survive a bad drop.
        try {
          if (isImage && acceptsImages) {
            if (file.size > MAX_IMAGE_BYTES) {
              setNotice(t('chat.imageTooLarge', { name: file.name, mb: MAX_IMAGE_BYTES / 1024 / 1024 }));
              continue;
            }
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error ?? new Error('read failed'));
              reader.readAsDataURL(file);
            });
            added.push({ kind: 'image', name: file.name || 'image.png', dataUrl });
          } else if (isCsv && acceptsCsv) {
            if (file.size > MAX_CSV_BYTES) {
              setNotice(t('chat.csvTooLarge', { name: file.name, mb: MAX_CSV_BYTES / 1024 / 1024 }));
              continue;
            }
            const text = await file.text();
            added.push({ kind: 'csv', name: file.name, text, rows: countRows(text) });
          } else {
            setNotice(t('chat.notImageOrCsv', { name: file.name }));
          }
        } catch {
          setNotice(t('chat.readFailed', { name: file.name }));
        }
      }
      if (added.length) setAttachments((current) => [...current, ...added]);
    },
    [acceptsCsv, acceptsImages, t],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!acceptsImages) return;
      const files: File[] = [];
      for (const item of Array.from(event.clipboardData?.items ?? [])) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) files.push(file);
      }
      if (files.length) {
        event.preventDefault();
        void ingest(files);
      }
    },
    [acceptsImages, ingest],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      event.preventDefault();
      const files = event.dataTransfer?.files;
      if (files?.length) void ingest(files);
    },
    [ingest],
  );

  const lastItem = chat.items[chat.items.length - 1];
  const accept = useMemo(
    () => [acceptsImages ? 'image/*' : '', acceptsCsv ? '.csv,text/csv,application/vnd.ms-excel' : '']
      .filter(Boolean)
      .join(','),
    [acceptsCsv, acceptsImages],
  );

  return (
    <div className="harness-root harness-chat">
      <div className="harness-chat-log">
        {header}
        {chat.loading && chat.items.length === 0 && (
          <div className="harness-muted harness-chat-loading">{t('chat.loadingHistory')}</div>
        )}
        {!chat.loading && chat.items.length === 0 && (
          <div className="harness-empty">
            <p className="harness-empty-title">{t('empty.title')}</p>
            <p className="harness-empty-body">{t('empty.body')}</p>
          </div>
        )}

        {chat.items.map((item) => {
          if (isUserItem(item)) return <UserBubble key={item.id} item={item} t={t} />;
          if (isAssistantItem(item)) {
            return (
              <AssistantBubble
                key={item.id}
                item={item}
                t={t}
                interactive={item === lastItem && !chat.busy && canEdit}
                onPick={(option) => {
                  if (option.build) {
                    setPlan(false);
                    submit(option.label, { planMode: false });
                    return;
                  }
                  submit(option.label);
                }}
                onPlanOff={() => {
                  setPlan(false);
                  setPlanNotice('off');
                }}
                showPlanOff={planMode && item === lastItem && !chat.busy && canEdit}
              />
            );
          }
          if (isToolItem(item)) return <ToolCard key={item.id} item={item} t={t} />;
          return null;
        })}

        {planNotice && (
          <div className="harness-plan-notice">
            {planNotice === 'undone' ? (
              t('chat.planBackOn')
            ) : (
              <>
                {t('chat.planOffNotice')}{' '}
                <button
                  type="button"
                  className="harness-link"
                  onClick={() => {
                    setPlan(true);
                    setPlanNotice('undone');
                  }}
                >
                  {t('chat.undo')}
                </button>
              </>
            )}
          </div>
        )}

        {chat.activity && <ActivityLine activity={chat.activity} planMode={planMode} t={t} />}
        <div ref={endRef} />
      </div>

      {notice && (
        <div className="harness-notice">
          <span>{notice}</span>
          <button type="button" className="harness-icon-btn" aria-label={t('preview.dismiss')} onClick={() => setNotice(null)}>
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      {!canEdit ? (
        <div className="harness-readonly">{t('composer.readOnly')}</div>
      ) : (
        <form
          className="harness-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          {attachments.length > 0 && (
            <div className="harness-attachments">
              {attachments.map((attachment, index) => (
                <AttachmentChip
                  key={`${attachment.name}-${index}`}
                  attachment={attachment}
                  t={t}
                  onRemove={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                />
              ))}
            </div>
          )}

          <div className="harness-composer-row">
            {canAttach && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept={accept}
                  multiple
                  className="harness-hidden-input"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    if (event.target.files) void ingest(event.target.files);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                />
                <button
                  type="button"
                  className="harness-icon-btn"
                  title={t('composer.attach')}
                  aria-label={t('composer.attach')}
                  disabled={chat.busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <AttachIcon size={16} />
                </button>
              </>
            )}

            <textarea
              ref={textareaRef}
              className="harness-textarea"
              rows={1}
              value={input}
              disabled={chat.busy}
              placeholder={t('composer.placeholder')}
              onChange={(event) => setInput(event.target.value)}
              onPaste={onPaste}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />

            {chat.busy ? (
              <button type="button" className="harness-btn harness-btn-neutral" onClick={chat.stop} title={t('composer.stop')}>
                <StopIcon size={12} />
                {t('composer.stop')}
              </button>
            ) : (
              <button type="submit" className="harness-btn harness-btn-primary" title={t('composer.send')}>
                <SendIcon size={14} />
                {t('composer.send')}
              </button>
            )}
          </div>

          {models.length > 0 && (
            <div className="harness-composer-meta">
              <label className="harness-muted" htmlFor={`harness-model-${projectId}`}>
                {t('composer.model')}
              </label>
              <select
                id={`harness-model-${projectId}`}
                className="harness-select"
                value={model}
                disabled={chat.busy}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="">{t('composer.modelAuto')}</option>
                {models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Pieces
 * ------------------------------------------------------------------------- */

function UserBubble({ item, t }: { item: UserChatItem; t: Translate }): ReactElement {
  const attachments = item.attachments ?? [];
  return (
    <div className="harness-user-row">
      <div className="harness-user-stack">
        {attachments.length > 0 && (
          <div className="harness-attachments harness-attachments-end">
            {attachments.map((attachment, index) =>
              attachment.kind === 'image' ? (
                <img key={index} className="harness-attachment-image" src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <span key={index} className="harness-attachment">
                  <SheetIcon size={12} />
                  {attachment.name}
                  {attachment.rows ? ` · ${t('chat.rows', { rows: attachment.rows })}` : ''}
                </span>
              ),
            )}
          </div>
        )}
        {item.text && <div className="harness-bubble">{item.text}</div>}
      </div>
    </div>
  );
}

function AssistantBubble({
  item,
  t,
  interactive,
  onPick,
  onPlanOff,
  showPlanOff,
}: {
  item: AssistantChatItem;
  t: Translate;
  interactive: boolean;
  onPick: (option: ChoiceOption) => void;
  onPlanOff: () => void;
  showPlanOff: boolean;
}): ReactElement {
  const segments = useMemo(() => parseAssistantSegments(item.text), [item.text]);
  return (
    <div className={item.isError ? 'harness-assistant harness-assistant-error' : 'harness-assistant'}>
      {segments.map((segment, index) => {
        if (segment.kind === 'md') return <Markdown key={index} text={segment.text} />;
        if (segment.kind === 'choices-loading') return <div key={index} className="harness-choices-loading" />;
        return (
          <ChoicesCard
            key={index}
            spec={segment.spec}
            interactive={interactive}
            onPick={onPick}
            onPlanOff={showPlanOff ? onPlanOff : undefined}
            t={t}
          />
        );
      })}
    </div>
  );
}

function ChoicesCard({
  spec,
  interactive,
  onPick,
  onPlanOff,
  t,
}: {
  spec: ChoiceSpec;
  interactive: boolean;
  onPick: (option: ChoiceOption) => void;
  onPlanOff?: () => void;
  t: Translate;
}): ReactElement {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [answered, setAnswered] = useState<string | null>(null);

  const choose = (option: ChoiceOption): void => {
    if (!interactive) return;
    if (spec.multi) {
      setPicked((current) =>
        current.includes(option.label) ? current.filter((l) => l !== option.label) : [...current, option.label],
      );
      return;
    }
    setAnswered(option.label);
    onPick(option);
  };

  const hasOther = other.trim().length > 0;
  const canConfirm = hasOther || (spec.multi && picked.length > 0);
  const confirm = (): void => {
    if (!interactive || !canConfirm) return;
    const labels = spec.multi ? [...picked, ...(hasOther ? [other.trim()] : [])] : [other.trim()];
    const answer = labels.join(', ');
    const build = spec.options.some((option) => option.build && picked.includes(option.label));
    setAnswered(answer);
    onPick({ label: answer, build: build || undefined });
  };

  return (
    <div className="harness-choices">
      {spec.question && <div className="harness-choices-question">{spec.question}</div>}
      <div className="harness-choices-list">
        {spec.options.map((option) => {
          const on = spec.multi ? picked.includes(option.label) : answered === option.label;
          return (
            <button
              key={option.id ?? option.label}
              type="button"
              disabled={!interactive}
              onClick={() => choose(option)}
              className={on ? 'harness-choice harness-choice-on' : 'harness-choice'}
            >
              {spec.multi && <span className="harness-checkbox">{on && <CheckIcon size={11} />}</span>}
              <span>
                <span className="harness-choice-label">{option.label}</span>
                {option.description && <span className="harness-muted"> - {option.description}</span>}
              </span>
            </button>
          );
        })}
        {interactive && (
          <div className="harness-choices-other">
            <input
              type="text"
              className="harness-input"
              value={other}
              placeholder={t('chat.choicesOther')}
              onChange={(event) => setOther(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
            <button type="button" className="harness-btn harness-btn-soft" disabled={!canConfirm} onClick={confirm}>
              <CheckIcon size={13} />
              {spec.multi && !hasOther ? t('chat.choicesConfirm') : t('chat.choicesSend')}
            </button>
          </div>
        )}
      </div>
      {interactive && onPlanOff && (
        <div className="harness-choices-footer">
          <button type="button" className="harness-link" onClick={onPlanOff}>
            {t('chat.planOff')}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolCard({ item, t }: { item: ToolChatItem; t: Translate }): ReactElement {
  const running = item.status === 'streaming' || item.status === 'pending';
  return (
    <div className={running ? 'harness-tool harness-tool-running' : 'harness-tool'}>
      {running ? <SpinnerIcon size={12} /> : <CheckIcon size={12} className="harness-tool-done" />}
      <span>{describeTool(item, t)}</span>
    </div>
  );
}

function ActivityLine({
  activity,
  planMode,
  t,
}: {
  activity: ChatActivity;
  planMode: boolean;
  t: Translate;
}): ReactElement {
  const label =
    activity.kind === 'tool-running'
      ? t('chat.running', { name: activity.name.replace(/_/g, ' ') })
      : activity.kind === 'tool-input'
        ? t('chat.composing')
        : activity.kind === 'tool-result'
          ? t('chat.result')
          : planMode
            ? t('chat.planning')
            : t('chat.building');
  return (
    <div className="harness-activity">
      <SpinnerIcon size={13} />
      <span>{label}</span>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  t,
}: {
  attachment: Attachment;
  onRemove: () => void;
  t: Translate;
}): ReactElement {
  return (
    <span className="harness-attachment">
      {attachment.kind === 'image' ? (
        <img className="harness-attachment-thumb" src={attachment.dataUrl} alt="" />
      ) : (
        <SheetIcon size={13} />
      )}
      <span className="harness-attachment-name">
        {attachment.name}
        {attachment.kind === 'csv' && attachment.rows ? ` · ${t('chat.rows', { rows: attachment.rows })}` : ''}
      </span>
      <button type="button" className="harness-icon-btn" aria-label={t('chat.remove')} onClick={onRemove}>
        <CloseIcon size={12} />
      </button>
    </span>
  );
}
