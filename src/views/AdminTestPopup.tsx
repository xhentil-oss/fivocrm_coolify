import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button';

const AdminTestPopup: React.FC = () => {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test Popup për Admin</DialogTitle>
        </DialogHeader>
        <div className="py-4 text-center">
          <p className="mb-4">Ky është një popup test për admin. Mund ta mbyllësh me butonin më poshtë.</p>
          <Button onClick={() => setOpen(false)} className="w-full">Mbyll</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminTestPopup;
