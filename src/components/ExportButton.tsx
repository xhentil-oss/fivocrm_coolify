import React from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import Papa from 'papaparse';
import { useToast } from '../hooks/use-toast';

interface ExportButtonProps {
  data: any[];
  filename: string;
  columns?: string[];
}

const ExportButton: React.FC<ExportButtonProps> = ({ data, filename, columns }) => {
  const { toast } = useToast();

  const exportToCSV = () => {
    if (!data || data.length === 0) {
      toast({ title: 'Nuk ka të dhëna për eksport', variant: 'destructive' });
      return;
    }

    // Filter columns if specified
    let exportData = data;
    if (columns && columns.length > 0) {
      exportData = data.map(item => {
        const filtered: any = {};
        columns.forEach(col => {
          if (item[col] !== undefined) {
            let val = item[col];
            // Prevent CSV formula injection
            if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val)) {
              val = "'" + val;
            }
            filtered[col] = val;
          }
        });
        return filtered;
      });
    }

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToJSON = () => {
    if (!data || data.length === 0) {
      toast({ title: 'Nuk ka të dhëna për eksport', variant: 'destructive' });
      return;
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportToCSV}>
          <FileSpreadsheet className="w-4 h-4 mr-2" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportToJSON}>
          <FileText className="w-4 h-4 mr-2" />
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExportButton;
