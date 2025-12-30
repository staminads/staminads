import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Button, Empty, Select, Space } from 'antd'
import { PlusOutlined, FilterOutlined } from '@ant-design/icons'
import { filtersQueryOptions, filterTagsQueryOptions } from '../../../../lib/queries'
import { FilterList, FilterFormModal } from '../../../../components/filters'
import type { FilterWithStaleness } from '../../../../types/filters'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/filters')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(filtersQueryOptions(params.workspaceId)),
      context.queryClient.ensureQueryData(filterTagsQueryOptions(params.workspaceId)),
    ])
  },
  component: FiltersPage,
})

function FiltersPage() {
  const { workspaceId } = Route.useParams()
  const { data: filters } = useSuspenseQuery(filtersQueryOptions(workspaceId))
  const { data: tags } = useSuspenseQuery(filterTagsQueryOptions(workspaceId))

  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFilter, setEditingFilter] = useState<FilterWithStaleness | undefined>()

  const filteredFilters = useMemo(() => {
    if (selectedTags.length === 0) return filters
    return filters.filter((f) =>
      selectedTags.some((tag) => f.tags.includes(tag))
    )
  }, [filters, selectedTags])

  const sortedFilters = useMemo(() => {
    return [...filteredFilters].sort((a, b) => a.order - b.order)
  }, [filteredFilters])

  const handleCreate = () => {
    setEditingFilter(undefined)
    setModalOpen(true)
  }

  const handleEdit = (filter: FilterWithStaleness) => {
    setEditingFilter(filter)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingFilter(undefined)
  }

  const tagOptions = tags.map((tag) => ({ value: tag, label: tag }))

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Filters</h1>
          <p className="text-gray-500 mt-1">
            Define filters to set custom dimensions and modify traffic source fields
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          Create Filter
        </Button>
      </div>

      {filters.length > 0 && (
        <div className="mb-4">
          <Space>
            <FilterOutlined className="text-gray-400" />
            <Select
              mode="multiple"
              value={selectedTags}
              onChange={setSelectedTags}
              options={tagOptions}
              placeholder="Filter by tags..."
              className="min-w-48"
              allowClear
            />
          </Space>
        </div>
      )}

      {sortedFilters.length > 0 ? (
        <FilterList
          workspaceId={workspaceId}
          filters={sortedFilters}
          onEdit={handleEdit}
        />
      ) : filters.length > 0 ? (
        <Empty
          description="No filters match the selected tags"
          className="py-12"
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="text-gray-500">
              No filters yet. Create your first filter to start organizing your traffic data.
            </span>
          }
          className="py-12"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Filter
          </Button>
        </Empty>
      )}

      <FilterFormModal
        workspaceId={workspaceId}
        filter={editingFilter}
        existingTags={tags}
        open={modalOpen}
        onClose={handleCloseModal}
      />
    </div>
  )
}
