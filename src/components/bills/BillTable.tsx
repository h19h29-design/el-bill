import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import type { MonthlyBill } from '../../types'

interface BillTableProps {
  bills: MonthlyBill[]
}

const won = (value: number) => value.toLocaleString('ko-KR')

const columns: ColumnDef<MonthlyBill>[] = [
  { accessorKey: 'year', header: '연도' },
  { accessorKey: 'month', header: '월' },
  {
    accessorKey: 'usageKwh',
    header: '사용량(kWh)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'totalBillWon',
    header: '총 전기요금(원)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'appliedPowerKw',
    header: '요금적용전력(kW)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'maxDemandKw',
    header: '최대수요전력(kW)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'baseChargeWon',
    header: '기본요금(원)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'energyChargeWon',
    header: '전력량요금(원)',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'powerFactorChargeWon',
    header: '역률요금',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'climateChargeWon',
    header: '기후환경요금',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'fuelAdjustmentWon',
    header: '연료비조정액',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'vatWon',
    header: '부가세',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  {
    accessorKey: 'fundWon',
    header: '전력산업기반기금',
    cell: ({ getValue }) => won(Number(getValue())),
  },
  { accessorKey: 'note', header: '메모' },
]

export function BillTable({ bills }: BillTableProps) {
  const table = useReactTable({
    data: bills,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
