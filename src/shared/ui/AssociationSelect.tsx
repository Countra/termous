import { Select, Tooltip, type SelectProps, type TooltipProps } from 'antd'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import customSelectStyles from './CustomSelect.module.scss'
import uiStyles from './Primitives.module.scss'
import styles from './AssociationSelect.module.scss'

export interface AssociationSelectItem {
  value: string
  label: string
  searchText?: string
  disabled?: boolean
  ariaLabel?: string
}

export interface AssociationSelectProps<TItem extends AssociationSelectItem> extends Pick<
  SelectProps<string>,
  'status' | 'aria-invalid' | 'aria-describedby'
> {
  label: string
  value: string
  items: readonly TItem[]
  onChange: (value: string, item: TItem | undefined) => void
  onOpenChange?: (open: boolean) => void
  renderOption: (item: TItem) => ReactNode
  renderSelection: (item: TItem | undefined, value: string) => ReactNode
  renderDetails?: (item: TItem) => ReactNode | null
  groupBy?: (item: TItem) => { key: string; label: ReactNode }
  isItemVisible?: (item: TItem) => boolean
  matchesSearch?: (item: TItem, normalizedQuery: string) => boolean
  disabled?: boolean
  id?: string
  className?: string
  popupClassName?: string
  detailClassName?: string
  detailPlacement?: TooltipProps['placement']
  virtual?: boolean
}

interface AssociationSelectOption<TItem extends AssociationSelectItem> {
  value: string
  label: string
  item: TItem
  disabled?: boolean
  title: string
  'aria-label'?: string
}

interface AssociationSelectGroup<TItem extends AssociationSelectItem> {
  key: string
  label: ReactNode
  title: string
  options: AssociationSelectOption<TItem>[]
}

type AssociationSelectEntry<TItem extends AssociationSelectItem> =
  | AssociationSelectOption<TItem>
  | AssociationSelectGroup<TItem>

export function AssociationSelect<TItem extends AssociationSelectItem>({
  label,
  value,
  items,
  onChange,
  onOpenChange,
  renderOption,
  renderSelection,
  renderDetails,
  groupBy,
  isItemVisible,
  matchesSearch,
  disabled = false,
  id,
  className,
  popupClassName,
  detailClassName,
  detailPlacement = 'rightTop',
  virtual = false,
  status,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: AssociationSelectProps<TItem>) {
  const generatedId = useId()
  const controlId = id ?? `${generatedId}-control`
  const labelId = `${generatedId}-label`
  const [openDetailValue, setOpenDetailValue] = useState<string | null>(null)
  const selectOpenRef = useRef(false)
  const hoveredDetailValueRef = useRef<string | null>(null)
  const visibleItems = useMemo(
    () => isItemVisible ? items.filter(isItemVisible) : [...items],
    [isItemVisible, items],
  )
  const itemsByValue = useMemo(
    () => new Map(items.map((item) => [item.value, item])),
    [items],
  )
  const visibleValues = useMemo(
    () => new Set(visibleItems.map((item) => item.value)),
    [visibleItems],
  )
  const flatOptions = useMemo<AssociationSelectOption<TItem>[]>(
    () => visibleItems.map((item) => ({
      value: item.value,
      label: item.label,
      item,
      disabled: item.disabled,
      title: '',
      'aria-label': item.ariaLabel,
    })),
    [visibleItems],
  )
  const options = useMemo(() => {
    if (!groupBy) return flatOptions
    const groups = new Map<string, {
      label: ReactNode
      options: AssociationSelectOption<TItem>[]
    }>()
    for (const option of flatOptions) {
      const group = groupBy(option.item)
      const current = groups.get(group.key)
      if (current) {
        current.options.push(option)
      } else {
        groups.set(group.key, { label: group.label, options: [option] })
      }
    }
    return Array.from(groups, ([key, group]) => ({
      key,
      label: group.label,
      title: typeof group.label === 'string' ? group.label : '',
      options: group.options,
    }))
  }, [flatOptions, groupBy])

  useEffect(() => {
    hoveredDetailValueRef.current = null
    setOpenDetailValue(null)
  }, [value])

  useEffect(() => {
    const hoveredValue = hoveredDetailValueRef.current
    if (hoveredValue !== null && !visibleValues.has(hoveredValue)) {
      hoveredDetailValueRef.current = null
    }
    setOpenDetailValue((current) => (
      current !== null && !visibleValues.has(current) ? null : current
    ))
  }, [visibleValues])

  return (
    <div
      className={[
        customSelectStyles['custom-select'],
        'custom-select',
        className,
      ].filter(Boolean).join(' ')}
    >
      <label
        id={labelId}
        htmlFor={controlId}
        className={`${customSelectStyles['field-label']} field-label`}
      >
        {label}
      </label>
      <Select<string, AssociationSelectEntry<TItem>>
        id={controlId}
        value={value}
        options={options}
        virtual={virtual}
        listItemHeight={40}
        showSearch
        disabled={disabled}
        status={status}
        aria-labelledby={labelId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={`${customSelectStyles.select} ${styles.select} termous-select`}
        classNames={{
          popup: {
            root: [
              customSelectStyles['select-popup'],
              'termous-select-popup',
              styles.popup,
              popupClassName,
            ].filter(Boolean).join(' '),
          },
        }}
        optionLabelProp="label"
        filterOption={(input, option) => {
          if (!isAssociationSelectOption(option)) return false
          const normalizedQuery = normalizeSearchText(input)
          if (matchesSearch) return matchesSearch(option.item, normalizedQuery)
          return matchesDefaultSearch(option.item, normalizedQuery)
        }}
        labelRender={({ value: selectedValue }) => {
          const normalizedValue = String(selectedValue)
          return renderSelection(itemsByValue.get(normalizedValue), normalizedValue)
        }}
        optionRender={(option) => {
          if (!isAssociationSelectOption(option.data)) return option.label
          const item = option.data.item
          const details = renderDetails?.(item)
          const content = (
            <span
              className={styles['option-trigger']}
              onMouseEnter={() => {
                if (selectOpenRef.current) hoveredDetailValueRef.current = item.value
              }}
              onMouseLeave={() => {
                if (hoveredDetailValueRef.current === item.value) {
                  hoveredDetailValueRef.current = null
                }
              }}
            >
              {renderOption(item)}
            </span>
          )

          if (details == null) return content

          return (
            <Tooltip
              title={details}
              placement={detailPlacement}
              open={openDetailValue === item.value}
              mouseEnterDelay={0.2}
              mouseLeaveDelay={0.2}
              zIndex={3600}
              classNames={{
                root: [
                  uiStyles.tooltip,
                  'termous-tooltip',
                  styles['detail-tooltip'],
                  detailClassName,
                ].filter(Boolean).join(' '),
              }}
              onOpenChange={(open) => {
                setOpenDetailValue((current) => {
                  if (open) {
                    return selectOpenRef.current
                      && hoveredDetailValueRef.current === item.value
                      ? item.value
                      : current
                  }
                  return current === item.value ? null : current
                })
              }}
            >
              {content}
            </Tooltip>
          )
        }}
        onOpenChange={(open) => {
          selectOpenRef.current = open
          if (!open) {
            hoveredDetailValueRef.current = null
            setOpenDetailValue(null)
          }
          onOpenChange?.(open)
        }}
        onSearch={() => {
          hoveredDetailValueRef.current = null
          setOpenDetailValue(null)
        }}
        onPopupScroll={() => {
          hoveredDetailValueRef.current = null
          setOpenDetailValue(null)
        }}
        onChange={(nextValue) => {
          hoveredDetailValueRef.current = null
          setOpenDetailValue(null)
          onChange(nextValue, itemsByValue.get(nextValue))
        }}
      />
    </div>
  )
}

function isAssociationSelectOption<TItem extends AssociationSelectItem>(
  value: AssociationSelectEntry<TItem> | undefined,
): value is AssociationSelectOption<TItem> {
  return value !== undefined && 'item' in value
}

function matchesDefaultSearch(item: AssociationSelectItem, normalizedQuery: string) {
  if (!normalizedQuery) return true
  const searchText = normalizeSearchText(item.searchText ?? item.label)
  return normalizedQuery.split(/\s+/).every((token) => searchText.includes(token))
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase()
}
