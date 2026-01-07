import { useMemo, useState } from 'react'
import { Button, Dropdown, Tag, Tooltip, Empty, Input } from 'antd'
import { CloseOutlined, PlusCircleOutlined, SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { analyticsDimensionsQueryOptions } from '../../lib/queries'
import { groupDimensionsByCategory, getDimensionLabel, getDimensionExamples } from '../../lib/explore-utils'
import type { DimensionInfo } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

interface DimensionSelectorProps {
  value: string[]
  onChange: (dimensions: string[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

interface SortableDimensionChipProps {
  id: string
  dimension: string
  onRemove: () => void
  isLast: boolean
  customDimensionLabels?: CustomDimensionLabels | null
}

function SortableDimensionChip({ id, dimension, onRemove, isLast, customDimensionLabels }: SortableDimensionChipProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="inline-flex items-center">
      <Tag
        color="blue"
        className="m-0 flex items-center gap-1 cursor-grab"
        closable
        onClose={(e) => {
          e.preventDefault()
          onRemove()
        }}
        closeIcon={<CloseOutlined className="text-xs" />}
        {...attributes}
        {...listeners}
      >
        {getDimensionLabel(dimension, customDimensionLabels)}
      </Tag>
      {!isLast && <span className="mx-1 text-gray-400">›</span>}
    </div>
  )
}

export function DimensionSelector({ value, onChange, customDimensionLabels }: DimensionSelectorProps) {
  const { data: dimensionsData } = useQuery(analyticsDimensionsQueryOptions)
  const [searchTerm, setSearchTerm] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const dimensionsByCategory = useMemo(() => {
    if (!dimensionsData) return {}
    return groupDimensionsByCategory(dimensionsData as Record<string, DimensionInfo>)
  }, [dimensionsData])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = value.indexOf(active.id as string)
      const newIndex = value.indexOf(over.id as string)
      onChange(arrayMove(value, oldIndex, newIndex))
    }
  }

  const handleAddDimension = (dimension: string) => {
    if (!value.includes(dimension)) {
      onChange([...value, dimension])
    }
    setDropdownOpen(false)
    setSearchTerm('')
  }

  const handleRemoveDimension = (dimension: string) => {
    onChange(value.filter((d) => d !== dimension))
  }

  const allDimensionsSelected = useMemo(() => {
    if (!dimensionsData) return false
    return Object.keys(dimensionsData).every((d) => value.includes(d))
  }, [dimensionsData, value])

  // Filter dimensions by search term
  const filteredByCategory = useMemo(() => {
    const categoryOrder = ['UTM', 'Traffic', 'Pages', 'Device', 'Time', 'Geo', 'Custom']
    const sortedCategories = Object.keys(dimensionsByCategory).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a)
      const bIndex = categoryOrder.indexOf(b)
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })

    const result: Record<string, Array<{ name: string; type: string; category: string }>> = {}
    for (const category of sortedCategories) {
      const dims = dimensionsByCategory[category]?.filter(
        (dim) =>
          !value.includes(dim.name) &&
          (searchTerm === '' ||
            getDimensionLabel(dim.name, customDimensionLabels).toLowerCase().includes(searchTerm.toLowerCase()) ||
            category.toLowerCase().includes(searchTerm.toLowerCase())),
      )
      if (dims && dims.length > 0) {
        result[category] = dims
      }
    }
    return result
  }, [dimensionsByCategory, value, searchTerm, customDimensionLabels])

  const dropdownContent = (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="p-2 border-b border-gray-100">
        <Input
          placeholder="Search dimensions..."
          prefix={<SearchOutlined className="text-gray-400" />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          allowClear
        />
      </div>
      <div className="max-h-80 overflow-y-auto">
        {Object.keys(filteredByCategory).length === 0 ? (
          <div className="p-4">
            <Empty
              description={allDimensionsSelected ? 'All dimensions selected' : 'No dimensions found'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          Object.entries(filteredByCategory).map(([category, dims]) => (
            <div key={category}>
              <div className="text-[10px] font-semibold text-[var(--primary)] uppercase px-3 py-1">
                {category === 'Custom' ? 'Custom Dimensions' : category}
              </div>
              {dims.map((dim) => {
                const examples = getDimensionExamples(dim.name)
                const tooltipContent = (
                  <div className="text-xs">
                    <div className="font-mono text-gray-300">{dim.name}</div>
                    <div className="text-gray-400">Type: {dim.type}</div>
                    {examples && (
                      <div className="mt-1 text-gray-400">
                        e.g. {examples[0]}, {examples[1]}
                      </div>
                    )}
                  </div>
                )
                return (
                  <Tooltip key={dim.name} title={tooltipContent} placement="right">
                    <button
                      onClick={() => handleAddDimension(dim.name)}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                    >
                      {getDimensionLabel(dim.name, customDimensionLabels)}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={value} strategy={horizontalListSortingStrategy}>
        <div className="flex items-center gap-2 flex-wrap">
          <Dropdown
            trigger={['click']}
            open={dropdownOpen}
            onOpenChange={(open) => {
              setDropdownOpen(open)
              if (!open) setSearchTerm('')
            }}
            disabled={allDimensionsSelected}
            popupRender={() => dropdownContent}
          >
            <Button
              type="link"
              size="small"
              icon={<PlusCircleOutlined />}
              disabled={allDimensionsSelected}
            >
              Add dimension
            </Button>
          </Dropdown>

          {value.map((dimension, index) => (
            <SortableDimensionChip
              key={dimension}
              id={dimension}
              dimension={dimension}
              onRemove={() => handleRemoveDimension(dimension)}
              isLast={index === value.length - 1}
              customDimensionLabels={customDimensionLabels}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
