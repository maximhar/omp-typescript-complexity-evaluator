type BadgeProps = {
	value: number;
};

export function ScoreCard({ value }: BadgeProps) {
	const normalizedValue = value > 0 ? value : 0;
	return (
		<section>
			<ScoreBadge value={normalizedValue} />
		</section>
	);
}

function ScoreBadge({ value }: BadgeProps) {
	if (value > 10) {
		return <strong>{value}</strong>;
	}

	return <span>{value}</span>;
}
