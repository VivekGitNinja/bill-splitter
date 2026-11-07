-- Indexes for the lookups the API runs on every request.
-- Without these, listing a home's bills or a bill's shares scans the whole
-- table; with them, each lookup touches only that home's / bill's rows.

CREATE INDEX idx_bills_home_id ON bills (home_id);
CREATE INDEX idx_shares_bill_id ON shares (bill_id);
CREATE INDEX idx_shares_member_id ON shares (member_id);
