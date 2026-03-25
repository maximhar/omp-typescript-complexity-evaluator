export function normalizeOrders(orders: number[]): number {
	const selectedOrders = orders.filter((order) => order > 0);
	const doubledOrders = selectedOrders.map((order) => order * 2);
	return doubledOrders.reduce((total, order) => total + order, 0);
}

export function normalizeInvoices(invoices: number[]): number {
	const selectedInvoices = invoices.filter((invoice) => invoice > 0);
	const doubledInvoices = selectedInvoices.map((invoice) => invoice * 2);
	return doubledInvoices.reduce((sum, invoice) => sum + invoice, 0);
}

export function uniqueProcess(records: number[]): number {
	const trimmedRecords = records.slice(1);
	const summedRecords = trimmedRecords.reduce((total, record) => total + record, 0);
	return summedRecords;
}
